-- =====================================================================
-- 020: Google Calendar invites for meetings. Run after 019. Safe to re-run.
--
-- On a meeting, whoever manages it clicks "Send calendar invites". From
-- then on the meeting is kept in step with a real Google Calendar event
-- on the account that runs the email script: the people invited in the
-- portal get a calendar invitation with Accept / Decline, and are sent
-- an update when the date, time, title, details or guest list change,
-- or a cancellation when the meeting is deleted.
--
-- The email script (email/apps-script.gs) asks for this work with
-- cal_run and reports back with cal_done, using the same secret as the
-- emails. Nothing is sent while emails are switched off in Setup > Email
-- or while "Calendar invites for meetings" is unticked there.
-- =====================================================================

alter table public.mail_settings add column if not exists calendar_invites boolean not null default true;

alter table public.training_sessions add column if not exists meeting_link text;
alter table public.training_sessions add column if not exists cal_wanted boolean not null default false;   -- "Send calendar invites" was clicked
alter table public.training_sessions add column if not exists cal_event_id text;                          -- the Google Calendar event
alter table public.training_sessions add column if not exists cal_dirty boolean not null default false;   -- needs sending or updating
alter table public.training_sessions add column if not exists cal_version integer not null default 0;
alter table public.training_sessions add column if not exists cal_synced_at timestamptz;
alter table public.training_sessions add column if not exists cal_error text;

-- Calendar events whose meeting was deleted: the script cancels them.
create table if not exists app.cal_cancellations (
  event_id  text primary key,
  queued_at timestamptz not null default now()
);
alter table app.cal_cancellations enable row level security;
revoke all on app.cal_cancellations from public, anon, authenticated;

-- A change to what the invite shows marks the meeting for an update.
create or replace function app.cal_mark_session() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.cal_wanted and (
       new.title is distinct from old.title or new.session_date is distinct from old.session_date
    or new.start_time is distinct from old.start_time or new.duration_min is distinct from old.duration_min
    or new.description is distinct from old.description or new.meeting_link is distinct from old.meeting_link
    or new.mode is distinct from old.mode or (new.cal_wanted and not old.cal_wanted)) then
    new.cal_dirty := true;
    new.cal_version := old.cal_version + 1;
    new.cal_error := null;
  end if;
  return new;
end $$;
drop trigger if exists training_sessions_cal on public.training_sessions;
create trigger training_sessions_cal before update on public.training_sessions
  for each row execute function app.cal_mark_session();

-- A change to who is invited marks the meeting for an update.
create or replace function app.cal_mark_guests() returns trigger
language plpgsql security definer set search_path = '' as $$
declare ses uuid := coalesce(new.session_id, old.session_id);
begin
  update public.training_sessions ts set cal_dirty = true, cal_version = ts.cal_version + 1
   where ts.id = ses and ts.cal_wanted;
  return null;
end $$;
drop trigger if exists training_invites_cal on public.training_invites;
create trigger training_invites_cal after insert or delete on public.training_invites
  for each row execute function app.cal_mark_guests();
drop trigger if exists training_invites_logins_cal on public.training_invites_logins;
create trigger training_invites_logins_cal after insert or delete on public.training_invites_logins
  for each row execute function app.cal_mark_guests();

-- A deleted meeting with a calendar event: cancel the event.
create or replace function app.cal_cancel_on_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.cal_event_id is not null then
    insert into app.cal_cancellations (event_id) values (old.cal_event_id) on conflict do nothing;
  end if;
  return old;
end $$;
drop trigger if exists training_sessions_cal_delete on public.training_sessions;
create trigger training_sessions_cal_delete after delete on public.training_sessions
  for each row execute function app.cal_cancel_on_delete();

-- Email addresses of the people invited to a meeting.
create or replace function app.meeting_guests(p_session uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct lower(e)), '{}') from (
    select app.mail_address(i.profile_id) as e
      from public.training_invites_logins i where i.session_id = p_session
    union
    select coalesce(app.mail_address(p.id), case when p.id is null then nullif(trim(v.email), '') end)
      from public.training_invites i
      join public.volunteers v on v.id = i.volunteer_id
      left join public.profiles p on p.volunteer_id = v.id and p.active
     where i.session_id = p_session
  ) x where e is not null and e like '%@%' and e not like '%@portal.pratyagra.org'
$$;

-- May the signed-in person manage this meeting?
create or replace function app.can_manage_session(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.training_sessions ts where ts.id = p_session
                 and (app.is_staff() or (app.is_lead_of(ts.centre_id) and ts.audience <> 'Board only')))
$$;

-- How many invited people can be reached (have an email address), and how many cannot.
create or replace function public.meeting_invite_reach(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare total integer; reach integer;
begin
  if not app.can_manage_session(p_session) then raise exception 'Only the centre lead or the admin team can do this.'; end if;
  select (select count(*) from public.training_invites where session_id = p_session)
       + (select count(*) from public.training_invites_logins where session_id = p_session) into total;
  reach := coalesce(array_length(app.meeting_guests(p_session), 1), 0);
  return jsonb_build_object('invited', total, 'with_email', reach, 'without_email', greatest(total - reach, 0));
end $$;

-- "Send calendar invites" (or send them again after a problem).
create or replace function public.send_meeting_invites(p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.can_manage_session(p_session) then raise exception 'Only the centre lead or the admin team can do this.'; end if;
  update public.training_sessions ts
     set cal_wanted = true, cal_dirty = true, cal_version = ts.cal_version + 1, cal_error = null
   where ts.id = p_session;
end $$;

-- Called by the email script: the meetings to create or update, and the events to cancel.
create or replace function public.cal_run(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.mail_settings; items jsonb; cancels jsonb;
begin
  if p_secret is null or p_secret <> (select m.secret from app.mail_secret m) then raise exception 'Not allowed.'; end if;
  select * into s from public.mail_settings;
  if not (s.enabled and s.calendar_invites) then return jsonb_build_object('meetings', '[]'::jsonb, 'cancel', '[]'::jsonb); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', ts.id, 'version', ts.cal_version, 'event_id', ts.cal_event_id,
           'title', ts.title, 'description', ts.description, 'date', ts.session_date,
           'start_time', to_char(ts.start_time, 'HH24:MI'), 'minutes', coalesce(ts.duration_min, 60),
           'mode', ts.mode, 'link', ts.meeting_link, 'kind', ts.kind,
           'guests', to_jsonb(app.meeting_guests(ts.id)),
           'portal_url', s.portal_url || '/training')), '[]'::jsonb)
    into items
    from (select * from public.training_sessions where cal_wanted and cal_dirty order by session_date limit 20) ts;
  select coalesce(jsonb_agg(c.event_id), '[]'::jsonb) into cancels
    from (select event_id from app.cal_cancellations order by queued_at limit 20) c;
  return jsonb_build_object('meetings', items, 'cancel', cancels);
end $$;

-- Called by the email script after each meeting or cancellation.
create or replace function public.cal_done(p_secret text, p_session uuid, p_version integer, p_event_id text, p_error text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is null or p_secret <> (select m.secret from app.mail_secret m) then raise exception 'Not allowed.'; end if;
  if p_session is null then
    delete from app.cal_cancellations c where c.event_id = p_event_id;
    return;
  end if;
  update public.training_sessions ts
     set cal_event_id = coalesce(p_event_id, ts.cal_event_id),
         cal_synced_at = case when p_error is null then now() else ts.cal_synced_at end,
         cal_error = p_error,
         -- only clear "needs sending" if nothing changed while the script was working
         cal_dirty = case when ts.cal_version = p_version then false else ts.cal_dirty end
   where ts.id = p_session;
end $$;

revoke all on function app.cal_mark_session(), app.cal_mark_guests(), app.cal_cancel_on_delete() from public, anon, authenticated;
revoke all on function app.meeting_guests(uuid) from public, anon, authenticated;
revoke all on function public.meeting_invite_reach(uuid), public.send_meeting_invites(uuid) from public, anon;
grant execute on function public.meeting_invite_reach(uuid), public.send_meeting_invites(uuid) to authenticated;
grant execute on function app.can_manage_session(uuid) to authenticated;
-- the script signs in with the public key only; the secret is the lock
revoke all on function public.cal_run(text), public.cal_done(text, uuid, integer, text, text) from public;
grant execute on function public.cal_run(text), public.cal_done(text, uuid, integer, text, text) to anon, authenticated;
