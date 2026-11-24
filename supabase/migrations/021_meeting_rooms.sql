-- =====================================================================
-- 021: meeting rooms. Pratyagra's fixed Zoom rooms, chosen from a list
-- when adding a meeting or training. The room's link and passcode go
-- into the calendar invite and show on the meeting in the portal.
-- The admin team edits the rooms under Setup > Rooms.
-- Run after 020. Safe to re-run.
--
-- The passcode is not written in this file. Set it under Setup > Rooms.
-- =====================================================================

create table if not exists public.meeting_rooms (
  id       uuid primary key default gen_random_uuid(),
  name     text not null unique,
  link     text not null,
  passcode text,
  sort     integer not null default 10,
  active   boolean not null default true
);
alter table public.meeting_rooms enable row level security;

-- Everyone who can see meetings can see the rooms; the admin team edits them.
drop policy if exists read on public.meeting_rooms;
create policy read on public.meeting_rooms for select to authenticated
  using ((select app.my_role()) is not null and (select app.my_role()) <> 'partner');
drop policy if exists admin on public.meeting_rooms;
create policy admin on public.meeting_rooms for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
revoke all on public.meeting_rooms from anon;
grant select, insert, update, delete on public.meeting_rooms to authenticated;

insert into public.meeting_rooms (name, link, sort) values
  ('Conference Room', 'https://tinyurl.com/pefconferenceroom', 1),
  ('Classroom 1', 'https://tinyurl.com/pefclassroom-1', 2),
  ('Classroom 2', 'https://tinyurl.com/pefclassroom-2', 3),
  ('Classroom 3', 'https://tinyurl.com/pefclassroom-3', 4),
  ('Classroom 4', 'https://tinyurl.com/pefclassroom-4', 5)
on conflict (name) do nothing;

alter table public.training_sessions add column if not exists room_id uuid references public.meeting_rooms on delete set null;

-- Changing the room counts as a change to the calendar invite.
create or replace function app.cal_mark_session() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.cal_wanted and (
       new.title is distinct from old.title or new.session_date is distinct from old.session_date
    or new.start_time is distinct from old.start_time or new.duration_min is distinct from old.duration_min
    or new.description is distinct from old.description or new.meeting_link is distinct from old.meeting_link
    or new.room_id is distinct from old.room_id
    or new.mode is distinct from old.mode or (new.cal_wanted and not old.cal_wanted)) then
    new.cal_dirty := true;
    new.cal_version := old.cal_version + 1;
    new.cal_error := null;
  end if;
  return new;
end $$;

-- The script gets the room's name, link and passcode with each meeting.
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
           'mode', ts.mode, 'link', coalesce(r.link, ts.meeting_link), 'kind', ts.kind,
           'room', r.name, 'passcode', r.passcode,
           'guests', to_jsonb(app.meeting_guests(ts.id)),
           'portal_url', s.portal_url || '/training')), '[]'::jsonb)
    into items
    from (select * from public.training_sessions where cal_wanted and cal_dirty order by session_date limit 20) ts
    left join public.meeting_rooms r on r.id = ts.room_id;
  select coalesce(jsonb_agg(c.event_id), '[]'::jsonb) into cancels
    from (select event_id from app.cal_cancellations order by queued_at limit 20) c;
  return jsonb_build_object('meetings', items, 'cancel', cancels);
end $$;

-- A room's link or passcode changed: upcoming meetings in it send an update.
create or replace function app.cal_room_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.link is distinct from old.link or new.passcode is distinct from old.passcode or new.name is distinct from old.name then
    update public.training_sessions ts set cal_dirty = true, cal_version = ts.cal_version + 1
     where ts.room_id = new.id and ts.cal_wanted and ts.session_date >= current_date;
  end if;
  return new;
end $$;
drop trigger if exists meeting_rooms_cal on public.meeting_rooms;
create trigger meeting_rooms_cal after update on public.meeting_rooms
  for each row execute function app.cal_room_changed();
revoke all on function app.cal_room_changed() from public, anon, authenticated;
