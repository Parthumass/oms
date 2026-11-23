-- =====================================================================
-- 002: combined roles, and trainings that can be assigned to volunteers
-- Run after schema.sql. Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Combined roles.
-- A login has one main role. If it is also linked to a volunteer record,
-- the same person additionally acts as that volunteer: an admin, board
-- member or centre lead who teaches a class uses one login for both.
-- ---------------------------------------------------------------------
create or replace function app.my_volunteer() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.volunteer_id
  from public.profiles p
  join public.volunteers v on v.id = p.volunteer_id
  where p.id = (select auth.uid()) and p.active and p.role is not null and v.status = 'Active'
$$;

-- Marking a volunteer inactive switches off a volunteer-only login.
-- A lead or admin who also teaches keeps their main login.
create or replace function app.sync_volunteer_login() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    update public.profiles set active = (new.status = 'Active')
     where volunteer_id = new.id and role = 'volunteer';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Assignable trainings.
-- training_topics is the catalogue of trainings (admin team adds them).
-- training_assignments says which volunteer has to do which training.
-- ---------------------------------------------------------------------
alter table public.training_topics add column if not exists description text;
alter table public.training_topics add column if not exists link text;

create table if not exists public.training_assignments (
  id           uuid primary key default gen_random_uuid(),
  topic_id     uuid not null references public.training_topics on delete cascade,
  volunteer_id uuid not null references public.volunteers on delete cascade,
  due_date     date,
  completed_on date,
  assigned_by  uuid default auth.uid(),
  assigned_at  timestamptz not null default now(),
  unique (topic_id, volunteer_id)
);
create index if not exists training_assignments_volunteer_idx on public.training_assignments (volunteer_id);
alter table public.training_assignments enable row level security;

drop policy if exists read on public.training_assignments;
create policy read on public.training_assignments for select to authenticated
  using ((select app.is_staff())
      or volunteer_id = (select app.my_volunteer())
      or app.is_lead_of(app.volunteer_centre(volunteer_id)));
drop policy if exists manage on public.training_assignments;
create policy manage on public.training_assignments for all to authenticated
  using      ((select app.is_staff()) or app.is_lead_of(app.volunteer_centre(volunteer_id)))
  with check ((select app.is_staff()) or app.is_lead_of(app.volunteer_centre(volunteer_id)));

revoke all on public.training_assignments from anon;
grant select, insert, update, delete on public.training_assignments to authenticated;

-- Being marked present at a session on a training counts as completing it.
create or replace function app.complete_training() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t uuid;
  d date;
begin
  select topic_id, session_date into t, d from public.training_sessions where id = new.session_id;
  if t is not null then
    insert into public.training_assignments (topic_id, volunteer_id, completed_on)
    values (t, new.volunteer_id, d)
    on conflict (topic_id, volunteer_id)
      do update set completed_on = coalesce(public.training_assignments.completed_on, excluded.completed_on);
  end if;
  return new;
end $$;

drop trigger if exists training_attendance_complete on public.training_attendance;
create trigger training_attendance_complete after insert on public.training_attendance
  for each row execute function app.complete_training();

grant execute on all functions in schema app to authenticated;

-- Volunteer hours report: training counts now come from assignments.
create or replace view public.volunteer_hours with (security_invoker = true) as
select v.id as volunteer_id, v.code, v.full_name, v.centre_id, v.status,
       coalesce(t.n, 0)     as classes_taken,
       coalesce(t.mins, 0)  as teaching_min,
       coalesce(e.n, 0)     as events_attended,
       coalesce(e.mins, 0)  as event_min,
       coalesce(n.mins, 0)  as other_min,
       coalesce(tr.n, 0)    as trainings_attended,
       coalesce(ta.core, 0) as core_trainings_done,
       coalesce(ta.assigned, 0) as trainings_assigned,
       coalesce(ta.done, 0)     as trainings_done
from public.volunteers v
left join lateral (
  select count(*) as n, sum(coalesce(s.duration_min, c.duration_min)) as mins
  from public.sessions s join public.classes c on c.id = s.class_id
  where coalesce(s.taught_by, c.volunteer_id) = v.id
) t on true
left join lateral (
  select count(*) as n, sum(coalesce(ev.duration_min, 0)) as mins
  from public.event_volunteers evv join public.events ev on ev.id = evv.event_id
  where evv.volunteer_id = v.id
) e on true
left join lateral (
  select sum(duration_min) as mins from public.non_teaching_logs l where l.volunteer_id = v.id
) n on true
left join lateral (
  select count(*) as n from public.training_attendance x where x.volunteer_id = v.id
) tr on true
left join lateral (
  select count(*) as assigned,
         count(*) filter (where a.completed_on is not null) as done,
         count(*) filter (where a.completed_on is not null and tt.is_core) as core
  from public.training_assignments a join public.training_topics tt on tt.id = a.topic_id
  where a.volunteer_id = v.id
) ta on true;
