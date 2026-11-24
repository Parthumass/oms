-- =====================================================================
-- 024: rooms for classes, room bookings, proposed classes, and no double
-- booking. Run after 023. Safe to re-run.
--
-- Rooms (Setup > Rooms) are the shared Zoom rooms. A class can be held in
-- one of them, or in the volunteer's own classroom (their own link).
--
-- Requests (schedule_requests):
--   new_class    a teacher proposes a new class (days, time, room)
--   extra_class  a teacher adds one extra class on a date
--   room         anyone books a room for a date, e.g. a team meeting
-- Approval:
--   a new or extra class needs the centre lead (or admin team / board);
--   anything that uses a room then needs the admin team or board.
--   Steps the person asking could approve themselves are skipped, so a
--   centre lead's own extra class in their own link is approved at once.
-- When approved, a new class is created with the teacher on it, and an
-- extra class gets its date on the attendance sheet.
--
-- No double booking: a room cannot hold two things at once. Classes repeat
-- weekly between their start and end dates; meetings and bookings are on
-- one date. Requests still waiting hold the room too, so two people cannot
-- request the same slot. The volunteer's own classroom is never checked.
-- =====================================================================

alter table public.classes add column if not exists room_id uuid references public.meeting_rooms on delete set null;
alter table public.classes add column if not exists own_room boolean not null default false;
alter table public.classes add column if not exists meeting_link text;    -- the volunteer's own link, when own_room
do $$ begin
  alter table public.classes add constraint classes_one_room check (not (own_room and room_id is not null));
exception when duplicate_object then null; end $$;

create table if not exists public.schedule_requests (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('new_class', 'extra_class', 'room')),
  title           text not null,
  centre_id       uuid references public.centres on delete cascade,
  class_id        uuid references public.classes on delete cascade,
  program_id      uuid references public.programs on delete set null,
  subject         text,
  team_id         uuid references public.teams on delete set null,
  weekdays        smallint[] not null default '{}',     -- new_class
  start_date      date not null,                        -- new_class: first week; otherwise the date
  start_time      time not null,
  duration_min    integer not null default 60 check (duration_min between 15 and 480),
  room_id         uuid references public.meeting_rooms on delete set null,
  own_room        boolean not null default false,
  meeting_link    text,
  note            text,
  requested_by    uuid default auth.uid() references public.profiles on delete cascade,
  requester_name  text,
  teacher_id      uuid references public.volunteers on delete set null,
  status          text not null default 'Waiting for centre lead'
                  check (status in ('Waiting for centre lead', 'Waiting for board', 'Approved', 'Declined', 'Cancelled')),
  lead_ok_by_name text,
  decided_by_name text,
  decision_note   text,
  decided_at      timestamptz,
  created_class   uuid references public.classes on delete set null,
  created_at      timestamptz not null default now(),
  check (not (own_room and room_id is not null))
);
create index if not exists schedule_requests_room on public.schedule_requests (room_id, start_date);
alter table public.schedule_requests enable row level security;

-- Who can see a request: the person who asked, the centre lead, the admin
-- team and board. Everyone (but partners) can see which rooms are taken.
drop policy if exists read on public.schedule_requests;
create policy read on public.schedule_requests for select to authenticated
  using ((select app.is_staff())
      or requested_by = (select auth.uid())
      or (centre_id is not null and app.is_lead_of(centre_id))
      or (room_id is not null and status in ('Waiting for centre lead', 'Waiting for board', 'Approved')
          and (select app.my_role()) is not null and (select app.my_role()) <> 'partner'));
revoke all on public.schedule_requests from anon;
revoke insert, update, delete on public.schedule_requests from authenticated;
grant select on public.schedule_requests to authenticated;

-- "Mon, Wed 17:00-18:00 IST"
create or replace function app.slot_label(p_days integer[], p_start time, p_min integer) returns text
language sql immutable set search_path = '' as $$
  select coalesce((select string_agg((array['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[d + 1], ', ' order by d) from unnest(p_days) d) || ' ', '')
      || to_char(p_start, 'HH24:MI') || '-' || to_char(p_start + make_interval(mins => coalesce(p_min, 60)), 'HH24:MI') || ' IST'
$$;

-- Is the room taken? Returns what it is taken by, or null if free.
-- p_days are the weekdays asked for (0 = Sunday); p_from..p_to the dates
-- (p_to null = no end). A one-off date is p_days = {its weekday}, p_from = p_to = it.
create or replace function app.room_busy(p_room uuid, p_days integer[], p_from date, p_to date, p_start time, p_min integer,
                                         p_skip_class uuid default null, p_skip_session uuid default null, p_skip_request uuid default null)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  fin date := coalesce(p_to, 'infinity'::date);
  e time := p_start + make_interval(mins => coalesce(p_min, 60));
  rname text; c record;
begin
  if p_room is null or p_start is null or coalesce(cardinality(p_days), 0) = 0 then return null; end if;
  select name into rname from public.meeting_rooms where id = p_room;

  select o.name, o.weekdays, o.start_time, o.duration_min into c from public.classes o
   where o.id is distinct from p_skip_class and o.active and o.room_id = p_room and o.start_time is not null
     and o.weekdays && p_days::smallint[]
     and o.start_date <= fin and coalesce(o.end_date, 'infinity'::date) >= p_from
     and o.start_time < e and p_start < o.start_time + make_interval(mins => coalesce(o.duration_min, 60))
   order by o.name limit 1;
  if found then
    return format('%s is already booked for the class "%s" (%s)', rname, c.name,
      app.slot_label(array(select unnest(c.weekdays) intersect select unnest(p_days::smallint[]))::int[], c.start_time, c.duration_min));
  end if;

  select t.title, t.session_date, t.start_time, t.duration_min into c from public.training_sessions t
   where t.id is distinct from p_skip_session and t.room_id = p_room and t.start_time is not null
     and t.session_date between greatest(p_from, today) and fin
     and extract(dow from t.session_date)::int = any (p_days)
     and t.start_time < e and p_start < t.start_time + make_interval(mins => coalesce(t.duration_min, 60))
   order by t.session_date limit 1;
  if found then
    return format('%s is already booked for "%s" on %s (%s)', rname, c.title, to_char(c.session_date, 'Dy DD Mon'),
      app.slot_label(null, c.start_time, c.duration_min));
  end if;

  select r.title, r.start_date, r.start_time, r.duration_min, r.status into c from public.schedule_requests r
   where r.id is distinct from p_skip_request and r.kind <> 'new_class' and r.room_id = p_room
     and r.status in ('Waiting for centre lead', 'Waiting for board', 'Approved')
     and r.start_date between greatest(p_from, today) and fin
     and extract(dow from r.start_date)::int = any (p_days)
     and r.start_time < e and p_start < r.start_time + make_interval(mins => r.duration_min)
   order by r.start_date limit 1;
  if found then
    return format('%s is %s for "%s" on %s (%s)', rname, case when c.status = 'Approved' then 'already booked' else 'already requested' end,
      c.title, to_char(c.start_date, 'Dy DD Mon'), app.slot_label(null, c.start_time, c.duration_min));
  end if;

  select r.title, r.weekdays, r.start_time, r.duration_min into c from public.schedule_requests r
   where r.id is distinct from p_skip_request and r.kind = 'new_class' and r.room_id = p_room
     and r.status in ('Waiting for centre lead', 'Waiting for board')
     and r.weekdays && p_days::smallint[] and r.start_date <= fin
     and r.start_time < e and p_start < r.start_time + make_interval(mins => r.duration_min)
   limit 1;
  if found then
    return format('%s is already requested for the proposed class "%s" (%s)', rname, c.title,
      app.slot_label(array(select unnest(c.weekdays) intersect select unnest(p_days::smallint[]))::int[], c.start_time, c.duration_min));
  end if;
  return null;
end $$;
revoke all on function app.room_busy(uuid, integer[], date, date, time, integer, uuid, uuid, uuid) from public, anon, authenticated;

-- Classes: check the room when the room, days, time, length or dates change.
create or replace function app.check_class_room() returns trigger
language plpgsql security definer set search_path = '' as $$
declare busy text;
begin
  if new.room_id is null or not new.active then return new; end if;
  if tg_op = 'UPDATE' and new.room_id is not distinct from old.room_id and new.weekdays is not distinct from old.weekdays
     and new.start_time is not distinct from old.start_time and new.duration_min is not distinct from old.duration_min
     and new.start_date is not distinct from old.start_date and new.end_date is not distinct from old.end_date
     and new.active is not distinct from old.active then
    return new;
  end if;
  busy := app.room_busy(new.room_id, new.weekdays::int[], new.start_date, new.end_date, new.start_time, new.duration_min, p_skip_class => new.id);
  if busy is not null then raise exception '%. Choose another room or another time.', busy; end if;
  return new;
end $$;
drop trigger if exists classes_room on public.classes;
create trigger classes_room before insert or update on public.classes
  for each row execute function app.check_class_room();

-- Meetings and trainings: the same check for their one date.
create or replace function app.check_meeting_room() returns trigger
language plpgsql security definer set search_path = '' as $$
declare busy text;
begin
  if new.room_id is null or new.start_time is null then return new; end if;
  if tg_op = 'UPDATE' and new.room_id is not distinct from old.room_id and new.session_date is not distinct from old.session_date
     and new.start_time is not distinct from old.start_time and new.duration_min is not distinct from old.duration_min then
    return new;
  end if;
  busy := app.room_busy(new.room_id, array[extract(dow from new.session_date)::int], new.session_date, new.session_date,
                        new.start_time, new.duration_min, p_skip_session => new.id);
  if busy is not null then raise exception '%. Choose another room or another time.', busy; end if;
  return new;
end $$;
drop trigger if exists training_sessions_room on public.training_sessions;
create trigger training_sessions_room before insert or update on public.training_sessions
  for each row execute function app.check_meeting_room();

revoke all on function app.check_class_room(), app.check_meeting_room() from public, anon, authenticated;

-- Carry out an approved request.
create or replace function app.apply_schedule(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.schedule_requests; cid uuid; busy text;
begin
  select * into r from public.schedule_requests where id = p_id;
  if r.kind = 'new_class' then
    insert into public.classes (centre_id, program_id, name, subject, volunteer_id, weekdays, start_time, duration_min,
                                start_date, mode, active, room_id, own_room, meeting_link)
    values (r.centre_id, r.program_id, r.title, r.subject, r.teacher_id, r.weekdays, r.start_time, r.duration_min,
            r.start_date, 'Online', true, r.room_id, r.own_room, r.meeting_link)
    returning id into cid;
    update public.schedule_requests set created_class = cid where id = p_id;
  else
    busy := app.room_busy(r.room_id, array[extract(dow from r.start_date)::int], r.start_date, r.start_date, r.start_time, r.duration_min, p_skip_request => r.id);
    if busy is not null then raise exception '%. This cannot be approved as it is.', busy; end if;
    if r.kind = 'extra_class' then
      insert into public.sessions (class_id, session_date, mode, duration_min)
      select r.class_id, r.start_date, c.mode, r.duration_min from public.classes c where c.id = r.class_id
      on conflict do nothing;
    end if;
  end if;
end $$;
revoke all on function app.apply_schedule(uuid) from public, anon, authenticated;

-- Ask for a new class, an extra class, or a room.
create or replace function public.request_schedule(
  p_kind text, p_title text, p_date date, p_start time, p_minutes integer default 60,
  p_room uuid default null, p_own_room boolean default false, p_link text default null,
  p_class uuid default null, p_centre uuid default null, p_program uuid default null, p_subject text default null,
  p_weekdays smallint[] default '{}', p_team uuid default null, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles; cls public.classes; centre uuid; busy text; st text; rid uuid;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  needs_lead boolean; needs_board boolean;
begin
  select * into me from public.profiles where id = (select auth.uid()) and active;
  if not found or me.role is null or me.role = 'partner' then raise exception 'You cannot make bookings.'; end if;
  if p_kind not in ('new_class', 'extra_class', 'room') then raise exception 'Unknown request.'; end if;
  if p_start is null or p_date is null then raise exception 'Choose a date and a start time.'; end if;
  if p_date < today then raise exception 'Choose today or a later date.'; end if;
  if p_link is not null and trim(p_link) <> '' and trim(p_link) !~* '^https?://' then raise exception 'A link must start with http:// or https://'; end if;
  if p_room is not null and p_own_room then raise exception 'Choose a room or your own classroom, not both.'; end if;

  if p_kind = 'extra_class' then
    select * into cls from public.classes where id = p_class;
    if not found then raise exception 'Choose the class.'; end if;
    if not (app.is_staff() or app.is_lead_of(cls.centre_id) or app.teaches_class(cls.id)) then
      raise exception 'Only a teacher of this class or its centre lead can add an extra class.';
    end if;
    centre := cls.centre_id;
  elsif p_kind = 'new_class' then
    if p_centre is null or p_program is null or coalesce(cardinality(p_weekdays), 0) = 0 then
      raise exception 'Choose the centre, the program and at least one class day.';
    end if;
    centre := p_centre;
  else
    if p_room is null then raise exception 'Choose a room.'; end if;
    centre := coalesce(p_centre, app.login_centre(me.id));
  end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Give it a name.'; end if;

  if p_kind = 'new_class' then
    busy := app.room_busy(p_room, p_weekdays::int[], p_date, null, p_start, p_minutes);
  else
    busy := app.room_busy(p_room, array[extract(dow from p_date)::int], p_date, p_date, p_start, p_minutes);
  end if;
  if busy is not null then raise exception '%. Choose another room or another time.', busy; end if;

  needs_lead := p_kind <> 'room' and not (app.is_staff() or app.is_lead_of(centre));
  needs_board := p_room is not null and not app.is_staff();
  st := case when needs_lead then 'Waiting for centre lead' when needs_board then 'Waiting for board' else 'Approved' end;

  insert into public.schedule_requests (kind, title, centre_id, class_id, program_id, subject, team_id, weekdays, start_date,
         start_time, duration_min, room_id, own_room, meeting_link, note, requested_by, requester_name, teacher_id, status,
         lead_ok_by_name, decided_by_name, decided_at)
  values (p_kind, trim(p_title), centre, p_class, p_program, nullif(trim(p_subject), ''), p_team,
          case when p_kind = 'new_class' then p_weekdays else '{}' end, p_date, p_start, coalesce(p_minutes, 60),
          p_room, coalesce(p_own_room, false), nullif(trim(p_link), ''), nullif(trim(p_note), ''), me.id,
          coalesce(nullif(trim(me.full_name), ''), me.email), me.volunteer_id, st,
          case when p_kind <> 'room' and not needs_lead then coalesce(me.full_name, me.email) end,
          case when st = 'Approved' then coalesce(me.full_name, me.email) end,
          case when st = 'Approved' then now() end)
  returning id into rid;
  if st = 'Approved' then perform app.apply_schedule(rid); end if;
  return rid;
end $$;

-- Approve or decline the step that is waiting.
create or replace function public.decide_schedule(p_id uuid, p_approve boolean, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.schedule_requests; who text; nxt text;
begin
  select * into r from public.schedule_requests where id = p_id for update;
  if not found or r.status not in ('Waiting for centre lead', 'Waiting for board') then raise exception 'That request is no longer waiting.'; end if;
  if r.status = 'Waiting for centre lead' and not (app.is_staff() or app.is_lead_of(r.centre_id)) then
    raise exception 'Only the centre lead, the admin team or the board can decide this.';
  end if;
  if r.status = 'Waiting for board' and not app.is_staff() then
    raise exception 'Rooms are approved by the admin team or the board.';
  end if;
  select coalesce(nullif(trim(full_name), ''), email) into who from public.profiles where id = (select auth.uid());
  if not p_approve then
    update public.schedule_requests set status = 'Declined', decided_by_name = who, decision_note = nullif(trim(p_note), ''), decided_at = now() where id = p_id;
    return 'Declined';
  end if;
  nxt := case when r.status = 'Waiting for centre lead' and r.room_id is not null and not app.is_staff() then 'Waiting for board' else 'Approved' end;
  update public.schedule_requests
     set status = nxt,
         lead_ok_by_name = case when r.status = 'Waiting for centre lead' then who else lead_ok_by_name end,
         decided_by_name = case when nxt = 'Approved' then who end,
         decision_note = coalesce(nullif(trim(p_note), ''), decision_note),
         decided_at = case when nxt = 'Approved' then now() end
   where id = p_id;
  if nxt = 'Approved' then perform app.apply_schedule(p_id); end if;
  return nxt;
end $$;

-- Withdraw a request, or give back a room booking that is no longer needed.
create or replace function public.cancel_schedule(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.schedule_requests;
begin
  select * into r from public.schedule_requests where id = p_id for update;
  if not found then raise exception 'Request not found.'; end if;
  if not (r.requested_by = (select auth.uid()) or app.is_staff() or (r.centre_id is not null and app.is_lead_of(r.centre_id))) then
    raise exception 'Only the person who asked, the centre lead or the admin team can cancel this.';
  end if;
  if r.status in ('Declined', 'Cancelled') or (r.status = 'Approved' and r.kind = 'new_class') then
    raise exception 'This can no longer be cancelled.%', case when r.kind = 'new_class' and r.status = 'Approved' then ' The class has been created: change or close it under Classes.' else '' end;
  end if;
  update public.schedule_requests set status = 'Cancelled', decided_at = now() where id = p_id;
end $$;

revoke all on function public.request_schedule(text, text, date, time, integer, uuid, boolean, text, uuid, uuid, uuid, text, smallint[], uuid, text),
                       public.decide_schedule(uuid, boolean, text), public.cancel_schedule(uuid) from public, anon;
grant execute on function public.request_schedule(text, text, date, time, integer, uuid, boolean, text, uuid, uuid, uuid, text, smallint[], uuid, text),
                          public.decide_schedule(uuid, boolean, text), public.cancel_schedule(uuid) to authenticated;

-- What is in each room between two dates (at most about two months), for
-- the room schedule. Everyone but partners can see it, including classes
-- that are not theirs, so they can find a free slot. Board-only meetings
-- show as "Board meeting" to people outside the board and admin team.
create or replace function public.room_schedule(p_from date, p_to date)
returns table (room_id uuid, room text, day date, start_time time, minutes integer, title text, what text, status text)
language sql stable security definer set search_path = '' as $$
  with ok as (select (app.my_role() is not null and app.my_role() <> 'partner' and p_to >= p_from and p_to - p_from <= 62) as yes)
  select r.id, r.name, d::date, c.start_time, coalesce(c.duration_min, 60), c.name, 'Class', 'Approved'
    from ok, public.classes c join public.meeting_rooms r on r.id = c.room_id
    cross join lateral generate_series(greatest(p_from, c.start_date), least(p_to, coalesce(c.end_date, p_to)), interval '1 day') d
   where ok.yes and c.active and c.start_time is not null and extract(dow from d)::int = any (c.weekdays)
  union all
  select r.id, r.name, q.start_date + k, q.start_time, q.duration_min, q.title, 'Proposed class', q.status
    from ok, public.schedule_requests q join public.meeting_rooms r on r.id = q.room_id
    cross join lateral generate_series(0, 62) k
   where ok.yes and q.kind = 'new_class' and q.status in ('Waiting for centre lead', 'Waiting for board')
     and q.start_date + k between p_from and p_to and extract(dow from q.start_date + k)::int = any (q.weekdays)
  union all
  select r.id, r.name, t.session_date, t.start_time, coalesce(t.duration_min, 60),
         case when t.audience = 'Board only' and not app.is_staff() then 'Board meeting' else t.title end, t.kind, 'Approved'
    from ok, public.training_sessions t join public.meeting_rooms r on r.id = t.room_id
   where ok.yes and t.start_time is not null and t.session_date between p_from and p_to
  union all
  select r.id, r.name, q.start_date, q.start_time, q.duration_min, q.title,
         case q.kind when 'extra_class' then 'Extra class' else 'Room booking' end, q.status
    from ok, public.schedule_requests q join public.meeting_rooms r on r.id = q.room_id
   where ok.yes and q.kind <> 'new_class' and q.status in ('Waiting for centre lead', 'Waiting for board', 'Approved')
     and q.start_date between p_from and p_to
  order by 1, 3, 4
$$;
revoke all on function public.room_schedule(date, date) from public, anon;
grant execute on function public.room_schedule(date, date) to authenticated;
