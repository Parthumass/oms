-- =====================================================================
-- 007: class start times, time-change requests, and what the calendar
-- needs. Run after 006. Safe to run more than once.
--
-- A class has days of the week and a start time (India time, IST).
-- Only the centre lead of that centre (or an admin) can change them.
-- The class volunteer can ask for a change; the centre lead approves or
-- declines it in the portal, and an approved request updates the class.
-- =====================================================================

alter table public.classes add column if not exists start_time time;

create or replace function app.guard_class_time() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.start_time is distinct from old.start_time or new.weekdays is distinct from old.weekdays)
     and (select auth.uid()) is not null
     and not (app.is_admin() or app.is_lead_of(old.centre_id)) then
    raise exception 'Only the centre lead can change a class time.';
  end if;
  return new;
end $$;
drop trigger if exists classes_time_guard on public.classes;
create trigger classes_time_guard before update on public.classes
  for each row execute function app.guard_class_time();

create table if not exists public.class_time_requests (
  id             uuid primary key default gen_random_uuid(),
  class_id       uuid not null references public.classes on delete cascade,
  requested_by   uuid default auth.uid() references public.profiles on delete cascade,
  requester_name text,
  new_weekdays   smallint[] not null,
  new_start_time time not null,
  note           text,
  status         text not null default 'Pending' check (status in ('Pending','Approved','Declined')),
  decided_by_name text,
  decision_note  text,
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);
alter table public.class_time_requests enable row level security;

drop policy if exists read on public.class_time_requests;
create policy read on public.class_time_requests for select to authenticated
  using ((select app.is_staff())
      or requested_by = (select auth.uid())
      or app.is_lead_of(app.class_centre(class_id)));
drop policy if exists ins on public.class_time_requests;
create policy ins on public.class_time_requests for insert to authenticated
  with check (requested_by = (select auth.uid()) and status = 'Pending' and app.is_class_volunteer(class_id));
drop policy if exists del on public.class_time_requests;
create policy del on public.class_time_requests for delete to authenticated
  using (requested_by = (select auth.uid()) and status = 'Pending');

-- The centre lead (or an admin) decides. Approving changes the class.
create or replace function public.decide_time_request(p_request uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.class_time_requests;
begin
  select * into r from public.class_time_requests where id = p_request and status = 'Pending';
  if not found then raise exception 'That request is no longer waiting.'; end if;
  if not (app.is_admin() or app.is_lead_of(app.class_centre(r.class_id))) then
    raise exception 'Only the centre lead can decide this.';
  end if;
  if p_approve then
    update public.classes set weekdays = r.new_weekdays, start_time = r.new_start_time where id = r.class_id;
  end if;
  update public.class_time_requests
     set status = case when p_approve then 'Approved' else 'Declined' end,
         decision_note = nullif(trim(p_note), ''), decided_at = now(),
         decided_by_name = (select coalesce(full_name, email) from public.profiles where id = (select auth.uid()))
   where id = p_request;
end $$;

revoke all on public.class_time_requests from anon;
grant select, insert, delete on public.class_time_requests to authenticated;
revoke all on function public.decide_time_request(uuid, boolean, text) from public, anon;
grant execute on function public.decide_time_request(uuid, boolean, text) to authenticated;

-- Calendar: a centre lead sees the tasks of their own centre's volunteers,
-- whoever gave them, so the "whole centre" schedule is complete.
create or replace function app.login_centre(p_profile uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(p.centre_id, v.centre_id)
  from public.profiles p left join public.volunteers v on v.id = p.volunteer_id
  where p.id = p_profile
$$;
grant execute on function app.login_centre(uuid) to authenticated;

drop policy if exists read_centre on public.tasks;
create policy read_centre on public.tasks for select to authenticated
  using (app.is_lead_of(app.login_centre(assignee)));
