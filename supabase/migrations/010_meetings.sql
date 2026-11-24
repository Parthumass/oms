-- =====================================================================
-- 010: meetings. A training session can now be a Meeting, can have a
-- start time, and can have a list of people who were asked to come.
-- Together with the attendance already kept, that gives a record of
-- who was invited and who was there. Run after 009. Safe to re-run.
-- =====================================================================

do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.training_sessions'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%kind%' loop
    execute format('alter table public.training_sessions drop constraint %I', c);
  end loop;
end $$;
alter table public.training_sessions
  add constraint training_sessions_kind_check check (kind in ('Core','Monthly','Meeting','Other'));

alter table public.training_sessions add column if not exists start_time time;   -- India time

-- Who was asked to come to a session or meeting.
create table if not exists public.training_invites (
  session_id   uuid not null references public.training_sessions on delete cascade,
  volunteer_id uuid not null references public.volunteers on delete cascade,
  invited_by   uuid default auth.uid(),
  invited_at   timestamptz not null default now(),
  primary key (session_id, volunteer_id)
);
create index if not exists training_invites_volunteer_idx on public.training_invites (volunteer_id);
alter table public.training_invites enable row level security;

-- Same rules as attendance: the admin team and board, the person
-- themselves (read only), and the centre lead of the person or session.
drop policy if exists read on public.training_invites;
create policy read on public.training_invites for select to authenticated
  using ((select app.is_staff())
      or volunteer_id = (select app.my_volunteer())
      or app.is_lead_of(app.volunteer_centre(volunteer_id))
      or app.is_lead_of(app.training_centre(session_id)));
drop policy if exists manage on public.training_invites;
create policy manage on public.training_invites for all to authenticated
  using      ((select app.is_staff())
           or app.is_lead_of(app.volunteer_centre(volunteer_id))
           or app.is_lead_of(app.training_centre(session_id)))
  with check ((select app.is_staff())
           or app.is_lead_of(app.volunteer_centre(volunteer_id))
           or app.is_lead_of(app.training_centre(session_id)));

revoke all on public.training_invites from anon;
grant select, insert, update, delete on public.training_invites to authenticated;
