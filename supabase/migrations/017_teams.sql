-- =====================================================================
-- 017: teams. A named group of people, for example "English curriculum
-- team". Run after 016. Safe to re-run.
--
-- The admin team and board create teams and choose the members. A
-- member can be anyone with a login or a volunteer record, and a person
-- can be in several teams.
-- Any member of a team can give a task to that team's members, and
-- every member can see the team's tasks.
-- =====================================================================

create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  active      boolean not null default true,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

-- One row per member: a volunteer record, or a login for people who have no volunteer record.
create table if not exists public.team_members (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams on delete cascade,
  volunteer_id uuid references public.volunteers on delete cascade,
  profile_id   uuid references public.profiles on delete cascade,
  person_name  text,
  person_code  text,
  added_by     uuid default auth.uid(),
  added_at     timestamptz not null default now(),
  check ((volunteer_id is null) <> (profile_id is null))
);
create unique index if not exists team_members_volunteer_key on public.team_members (team_id, volunteer_id) where volunteer_id is not null;
create unique index if not exists team_members_profile_key on public.team_members (team_id, profile_id) where profile_id is not null;

alter table public.tasks add column if not exists team_id uuid references public.teams on delete set null;
alter table public.tasks add column if not exists team_name text;

alter table public.teams enable row level security;
alter table public.team_members enable row level security;

create or replace function app.fill_member_name() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.volunteer_id is not null then
    select v.full_name, v.code into new.person_name, new.person_code from public.volunteers v where v.id = new.volunteer_id;
  else
    select coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1)), p.code
      into new.person_name, new.person_code from public.profiles p where p.id = new.profile_id;
  end if;
  return new;
end $$;
drop trigger if exists team_members_name on public.team_members;
create trigger team_members_name before insert on public.team_members
  for each row execute function app.fill_member_name();

-- Is the signed-in person a member of this team?
create or replace function app.in_team(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members m
                 where m.team_id = p_team
                   and (m.profile_id = (select auth.uid()) or m.volunteer_id = app.my_volunteer()))
     and app.my_role() is not null
$$;

-- Is this login a member of this team (by login, or through their volunteer record)?
create or replace function app.login_in_team(p_login uuid, p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members m
                 left join public.profiles p on p.id = p_login
                 where m.team_id = p_team
                   and (m.profile_id = p_login or (m.volunteer_id is not null and m.volunteer_id = p.volunteer_id)))
$$;

drop policy if exists read on public.teams;
create policy read on public.teams for select to authenticated
  using ((select app.is_staff()) or app.in_team(id));
drop policy if exists manage on public.teams;
create policy manage on public.teams for all to authenticated
  using ((select app.is_staff())) with check ((select app.is_staff()));

drop policy if exists read on public.team_members;
create policy read on public.team_members for select to authenticated
  using ((select app.is_staff()) or app.in_team(team_id));
drop policy if exists manage on public.team_members;
create policy manage on public.team_members for all to authenticated
  using ((select app.is_staff())) with check ((select app.is_staff()));

-- The members of a team with the login each one signs in with (null if they have none yet).
create or replace function public.team_people(p_team uuid)
returns table (member_id uuid, volunteer_id uuid, profile_id uuid, full_name text, code text, role text)
language sql stable security definer set search_path = '' as $$
  select m.id, m.volunteer_id, p.id, coalesce(m.person_name, p.full_name), coalesce(m.person_code, p.code), p.role::text
    from public.team_members m
    left join public.profiles p on p.active and p.role is not null
         and (p.id = m.profile_id or (m.volunteer_id is not null and p.volunteer_id = m.volunteer_id))
   where m.team_id = p_team and (app.is_staff() or app.in_team(p_team))
   order by 4
$$;

-- Tasks: a team member may give a task to a fellow member, marked with the team.
drop policy if exists ins on public.tasks;
create policy ins on public.tasks for insert to authenticated
  with check (assigned_by = (select auth.uid()) and status = 'To do'
          and (app.can_assign_to(assignee)
               or (team_id is not null and app.in_team(team_id) and app.login_in_team(assignee, team_id)))
          and (team_id is null or (select app.is_staff()) or app.in_team(team_id)));
drop policy if exists upd on public.tasks;
create policy upd on public.tasks for update to authenticated
  using (app.can_manage_task(id))
  with check (app.can_manage_task(id)
          and (app.can_assign_to(assignee)
               or (team_id is not null and app.in_team(team_id) and app.login_in_team(assignee, team_id))));
-- Every member of a team can see that team's tasks.
drop policy if exists read_team on public.tasks;
create policy read_team on public.tasks for select to authenticated
  using (team_id is not null and app.in_team(team_id));

create or replace function app.can_see_task(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.can_manage_task(p_task)
      or exists (select 1 from public.tasks t where t.id = p_task and t.assignee = (select auth.uid())
                 and app.my_role() is not null)
      or exists (select 1 from public.tasks t where t.id = p_task and t.team_id is not null and app.in_team(t.team_id))
$$;

revoke all on public.teams, public.team_members from anon;
grant select, insert, update, delete on public.teams, public.team_members to authenticated;
revoke all on function app.fill_member_name() from public, anon, authenticated;
revoke all on function public.team_people(uuid) from public, anon;
grant execute on function public.team_people(uuid) to authenticated;
grant execute on function app.in_team(uuid), app.login_in_team(uuid, uuid) to authenticated;
