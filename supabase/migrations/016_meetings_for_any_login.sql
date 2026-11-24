-- =====================================================================
-- 016: meetings for the board and staff. Run after 015. Safe to re-run.
--
-- 1. People with a login but no volunteer record (board, admin team,
--    centre leads) can now be invited to a meeting and marked present.
-- 2. A meeting has a "who can see it" setting:
--      Everyone      as before: everyone at the meeting's centre, or
--                    all centres when no centre is chosen
--      Invited only  the people invited, whoever set it up, and the
--                    admin team and board
--      Board only    the admin team and board, nobody else
--    Anyone invited to a meeting can always see that meeting.
-- =====================================================================

alter table public.training_sessions add column if not exists audience text not null default 'Everyone'
  check (audience in ('Everyone','Invited only','Board only'));

create table if not exists public.training_invites_logins (
  session_id  uuid not null references public.training_sessions on delete cascade,
  profile_id  uuid not null references public.profiles on delete cascade,
  person_name text,
  person_code text,
  invited_by  uuid default auth.uid(),
  invited_at  timestamptz not null default now(),
  primary key (session_id, profile_id)
);
create table if not exists public.training_attendance_logins (
  session_id  uuid not null references public.training_sessions on delete cascade,
  profile_id  uuid not null references public.profiles on delete cascade,
  person_name text,
  person_code text,
  marked_by   uuid default auth.uid(),
  marked_at   timestamptz not null default now(),
  primary key (session_id, profile_id)
);
alter table public.training_invites_logins enable row level security;
alter table public.training_attendance_logins enable row level security;

-- Names are kept on the row so the record still reads well to people who cannot see the list of logins.
create or replace function app.fill_login_name() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1)), p.code
    into new.person_name, new.person_code
    from public.profiles p where p.id = new.profile_id;
  return new;
end $$;
drop trigger if exists training_invites_logins_name on public.training_invites_logins;
create trigger training_invites_logins_name before insert on public.training_invites_logins
  for each row execute function app.fill_login_name();
drop trigger if exists training_attendance_logins_name on public.training_attendance_logins;
create trigger training_attendance_logins_name before insert on public.training_attendance_logins
  for each row execute function app.fill_login_name();

-- Is the signed-in person invited to this session, by volunteer record or by login?
create or replace function app.invited_to(ses uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.training_invites i where i.session_id = ses and i.volunteer_id = app.my_volunteer())
      or exists (select 1 from public.training_invites_logins i where i.session_id = ses and i.profile_id = (select auth.uid()))
$$;

drop policy if exists read on public.training_sessions;
create policy read on public.training_sessions for select to authenticated
  using ((select app.is_staff())
      or (audience <> 'Board only'
          and (app.invited_to(id)
               or created_by = (select auth.uid())
               or (audience = 'Everyone'
                   and (select app.my_role()) in ('centre_lead','volunteer')
                   and (centre_id is null or centre_id = (select app.my_home_centre()))))));
-- A centre lead still sets up sessions for their own centre, but cannot make one board-only.
drop policy if exists manage on public.training_sessions;
create policy manage on public.training_sessions for all to authenticated
  using      ((select app.is_staff()) or (app.is_lead_of(centre_id) and audience <> 'Board only'))
  with check ((select app.is_staff()) or (app.is_lead_of(centre_id) and audience <> 'Board only'));

drop policy if exists read on public.training_invites_logins;
create policy read on public.training_invites_logins for select to authenticated
  using ((select app.is_staff()) or profile_id = (select auth.uid()) or app.is_lead_of(app.training_centre(session_id)));
drop policy if exists manage on public.training_invites_logins;
create policy manage on public.training_invites_logins for all to authenticated
  using      ((select app.is_staff()) or app.is_lead_of(app.training_centre(session_id)))
  with check ((select app.is_staff()) or app.is_lead_of(app.training_centre(session_id)));

drop policy if exists read on public.training_attendance_logins;
create policy read on public.training_attendance_logins for select to authenticated
  using ((select app.is_staff()) or profile_id = (select auth.uid()) or app.is_lead_of(app.training_centre(session_id)));
drop policy if exists manage on public.training_attendance_logins;
create policy manage on public.training_attendance_logins for all to authenticated
  using      ((select app.is_staff()) or app.is_lead_of(app.training_centre(session_id)))
  with check ((select app.is_staff()) or app.is_lead_of(app.training_centre(session_id)));

revoke all on public.training_invites_logins, public.training_attendance_logins from anon;
grant select, insert, update, delete on public.training_invites_logins, public.training_attendance_logins to authenticated;
revoke all on function app.fill_login_name() from public, anon, authenticated;
grant execute on function app.invited_to(uuid) to authenticated;
