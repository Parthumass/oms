-- =====================================================================
-- 014: time off. A person lets the team know they will be away (a trip,
-- medical, personal). This is a record, not a request: nothing is
-- approved or refused. Their supervisors see it, sort out cover, and
-- mark it as noted with a short reply. Run after 013. Safe to re-run.
--
-- Supervisors: for a volunteer, the centre lead(s) of their centre; for
-- a centre lead, a board member, or anyone with no centre lead, the
-- admin team and board.
-- Emails: to the person ("noted, your supervisors have been told") and
-- to the supervisors when it is logged; to the person again, with the
-- supervisor's reply, when it is marked as noted.
-- =====================================================================

alter table public.mail_settings add column if not exists time_off_emails boolean not null default true;

create table if not exists public.time_off (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles on delete cascade,
  person_name   text,
  person_code   text,
  volunteer_id  uuid references public.volunteers on delete set null,
  centre_id     uuid references public.centres on delete set null,
  kind          text not null check (kind in ('Vacation or trip','Medical','Personal','Other')),
  start_date    date not null,
  end_date      date not null,
  reason        text not null,
  noted_by      uuid,
  noted_by_name text,
  noted_at      timestamptz,
  reply         text,
  created_at    timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists time_off_dates_idx on public.time_off (start_date, end_date);
create index if not exists time_off_profile_idx on public.time_off (profile_id);
alter table public.time_off enable row level security;

-- Seen by: the person, the centre lead of their centre, the admin team and board.
drop policy if exists read on public.time_off;
create policy read on public.time_off for select to authenticated
  using (profile_id = (select auth.uid())
      or (select app.is_staff())
      or app.is_lead_of(centre_id));
-- The person can take their own entry back; the admin team can remove one made by mistake.
drop policy if exists del on public.time_off;
create policy del on public.time_off for delete to authenticated
  using (profile_id = (select auth.uid()) or (select app.is_admin()));
revoke all on public.time_off from anon, authenticated;
grant select, delete on public.time_off to authenticated;

-- May the signed-in person mark this entry as noted? A supervisor, never the person themselves.
create or replace function app.supervises_time_off(p_profile uuid, p_centre uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_profile is distinct from (select auth.uid())
     and (app.is_staff() or app.is_lead_of(p_centre))
$$;

-- Log time off. Name, ID and centre come from the login.
create or replace function public.log_time_off(p_kind text, p_start date, p_end date, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare p public.profiles; v public.volunteers; v_id uuid;
begin
  select * into p from public.profiles where id = (select auth.uid());
  if not found or p.role is null or not p.active or p.role = 'partner' then raise exception 'Sign in first.'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'The last day cannot be before the first day.'; end if;
  if p_end - p_start > 365 then raise exception 'Please log at most a year at a time.'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Please add a short reason. It is kept for our records only.'; end if;
  select * into v from public.volunteers where id = p.volunteer_id;
  insert into public.time_off (profile_id, person_name, person_code, volunteer_id, centre_id, kind, start_date, end_date, reason)
  values (p.id, coalesce(nullif(trim(p.full_name), ''), v.full_name, split_part(p.email, '@', 1)), coalesce(p.code, v.code),
          p.volunteer_id, coalesce(p.centre_id, v.centre_id), p_kind, p_start, p_end, trim(p_reason))
  returning id into v_id;
  return v_id;
end $$;

-- A supervisor marks it as noted (or takes that back), with a short reply to the person.
create or replace function public.note_time_off(p_id uuid, p_noted boolean, p_reply text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.time_off;
begin
  select * into t from public.time_off where id = p_id for update;
  if not found or not app.supervises_time_off(t.profile_id, t.centre_id) then
    raise exception 'Only this person''s centre lead or the admin team can mark it as noted.';
  end if;
  if p_noted then
    update public.time_off set noted_at = now(), noted_by = (select auth.uid()), noted_by_name = app.my_name(),
           reply = nullif(trim(coalesce(p_reply, '')), '') where id = p_id;
  else
    update public.time_off set noted_at = null, noted_by = null, noted_by_name = null, reply = null where id = p_id;
  end if;
end $$;

create or replace function app.queue_time_off_email() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s public.mail_settings;
  days text := case when new.start_date = new.end_date then to_char(new.start_date, 'Dy DD Mon YYYY')
                    else to_char(new.start_date, 'Dy DD Mon') || ' to ' || to_char(new.end_date, 'Dy DD Mon YYYY') end;
  who uuid; subj text; txt text; addr text;
  has_lead boolean;
begin
  select * into s from public.mail_settings;
  if not (s.enabled and s.time_off_emails) then return new; end if;
  if tg_op = 'UPDATE' and not (old.noted_at is null and new.noted_at is not null) then return new; end if;
  select exists (select 1 from public.profiles p where p.role = 'centre_lead' and p.centre_id = new.centre_id and p.active and p.id <> new.profile_id)
    into has_lead;

  for who, subj, txt in
    select x.who, x.subj, x.txt from (
      -- logged: a note back to the person
      select new.profile_id as who, 'Your time off is noted: ' || days as subj,
             'Thank you for letting us know. Your time off (' || lower(new.kind) || ', ' || days || E') is on record and your supervisors have been told.\n\n'
             || 'Nothing needs approving. If your dates change, remove the entry under Time off and add it again.' as txt
       where tg_op = 'INSERT'
      union all
      -- logged: to the supervisors
      select p.id, coalesce(new.person_name, 'A team member') || ' will be away: ' || days,
             coalesce(new.person_name, 'A team member') || coalesce(' (' || new.person_code || ')', '') || ' has let us know they will be away.' ||
             E'\n\nDates: ' || days || E'\nType: ' || new.kind || E'\nReason (for our records): ' || new.reason ||
             E'\n\nThis is for your information, not for approval. Please check whether any classes need cover, then mark it as noted under Time off.'
        from public.profiles p
       where tg_op = 'INSERT' and p.active and p.id <> new.profile_id
         and ((p.role = 'centre_lead' and p.centre_id = new.centre_id)
              or (not has_lead and p.role in ('admin', 'board')))
      union all
      -- noted: the supervisor's reply to the person
      select new.profile_id, 'Noted: your time off, ' || days,
             coalesce(new.reply, 'Noted, thank you for letting us know.') || E'\n\n' || coalesce(new.noted_by_name, 'Your supervisor')
       where tg_op = 'UPDATE'
    ) x
  loop
    addr := app.mail_address(who);
    continue when addr is null;
    insert into public.email_outbox (profile_id, to_email, subject, body, kind)
    values (who, addr, 'Pratyagra: ' || subj, txt || E'\n\nOpen the portal: ' || s.portal_url || '/time-off', 'time_off');
  end loop;
  return new;
end $$;
drop trigger if exists time_off_email on public.time_off;
create trigger time_off_email after insert or update on public.time_off
  for each row execute function app.queue_time_off_email();

revoke all on function app.queue_time_off_email() from public, anon, authenticated;
revoke all on function public.log_time_off(text, date, date, text), public.note_time_off(uuid, boolean, text) from public, anon;
grant execute on function public.log_time_off(text, date, date, text), public.note_time_off(uuid, boolean, text) to authenticated;
grant execute on function app.supervises_time_off(uuid, uuid) to authenticated;
