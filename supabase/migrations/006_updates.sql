-- =====================================================================
-- 006: updates (announcements). Post a message to everyone, to a team,
-- or to selected people. Run after 005. Safe to run more than once.
--
-- Audience:  everyone  every login except partner logins
--            team      chosen roles, optionally only one centre
--            people    the logins ticked when posting
-- Who can post:  admin and board -> any audience
--                centre lead     -> their own centre's team, or selected
--                                   volunteers of their centre
-- =====================================================================

create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  link        text,
  pinned      boolean not null default false,
  audience    text not null default 'everyone' check (audience in ('everyone','team','people')),
  roles       public.app_role[] not null default '{}',
  centre_id   uuid references public.centres on delete cascade,
  author      uuid default auth.uid() references public.profiles on delete set null,
  author_name text,
  created_at  timestamptz not null default now(),
  check (audience <> 'team' or cardinality(roles) > 0)
);

create table if not exists public.announcement_recipients (
  announcement_id uuid not null references public.announcements on delete cascade,
  profile_id      uuid not null references public.profiles on delete cascade,
  primary key (announcement_id, profile_id)
);

create table if not exists public.announcement_reads (
  announcement_id uuid not null references public.announcements on delete cascade,
  profile_id      uuid not null references public.profiles on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (announcement_id, profile_id)
);

alter table public.announcements enable row level security;
alter table public.announcement_recipients enable row level security;
alter table public.announcement_reads enable row level security;

create or replace function app.can_manage_announcement(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_staff()
      or exists (select 1 from public.announcements a
                 where a.id = p_id and a.author = (select auth.uid()) and app.my_role() is not null)
$$;

-- Row-based, so it also works for a row that is being inserted right now.
create or replace function app.sees_announcement(
  p_id uuid, p_author uuid, p_audience text, p_roles public.app_role[], p_centre uuid
) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.my_role() is not null and (
       app.is_staff()
    or p_author = (select auth.uid())
    or (p_audience = 'everyone' and app.my_role() <> 'partner')
    or (p_audience = 'team'
        and (app.my_role() = any (p_roles) or ('volunteer' = any (p_roles) and app.my_volunteer() is not null))
        and (p_centre is null or p_centre = app.my_home_centre()))
    or (p_audience = 'people' and exists (
          select 1 from public.announcement_recipients r
          where r.announcement_id = p_id and r.profile_id = (select auth.uid()))))
$$;

create or replace function app.can_see_announcement(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.announcements a
                 where a.id = p_id and app.sees_announcement(a.id, a.author, a.audience, a.roles, a.centre_id))
$$;

-- May the signed-in person post to this audience?
create or replace function app.can_post_to(p_audience text, p_roles public.app_role[], p_centre uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_staff()
      or (app.my_role() = 'centre_lead'
          and (p_audience = 'people'
               or (p_audience = 'team' and p_centre = app.my_centre()
                   and p_roles <@ array['volunteer','centre_lead']::public.app_role[])))
$$;

drop policy if exists read on public.announcements;
create policy read on public.announcements for select to authenticated
  using (app.sees_announcement(id, author, audience, roles, centre_id));
drop policy if exists ins on public.announcements;
create policy ins on public.announcements for insert to authenticated
  with check (author = (select auth.uid()) and app.can_post_to(audience, roles, centre_id));
drop policy if exists upd on public.announcements;
create policy upd on public.announcements for update to authenticated
  using (app.can_manage_announcement(id))
  with check (app.can_manage_announcement(id) and app.can_post_to(audience, roles, centre_id));
drop policy if exists del on public.announcements;
create policy del on public.announcements for delete to authenticated
  using (app.can_manage_announcement(id));

drop policy if exists read on public.announcement_recipients;
create policy read on public.announcement_recipients for select to authenticated
  using (profile_id = (select auth.uid()) or app.can_manage_announcement(announcement_id));
drop policy if exists manage on public.announcement_recipients;
create policy manage on public.announcement_recipients for all to authenticated
  using      (app.can_manage_announcement(announcement_id))
  with check (app.can_manage_announcement(announcement_id) and app.can_assign_to(profile_id));

drop policy if exists read on public.announcement_reads;
create policy read on public.announcement_reads for select to authenticated
  using (profile_id = (select auth.uid()) or app.can_manage_announcement(announcement_id));
drop policy if exists ins on public.announcement_reads;
create policy ins on public.announcement_reads for insert to authenticated
  with check (profile_id = (select auth.uid()) and app.can_see_announcement(announcement_id));

revoke all on public.announcements, public.announcement_recipients, public.announcement_reads from anon;
grant select, insert, update, delete on public.announcements, public.announcement_recipients to authenticated;
grant select, insert on public.announcement_reads to authenticated;
grant execute on function app.can_manage_announcement(uuid), app.can_see_announcement(uuid),
  app.sees_announcement(uuid, uuid, text, public.app_role[], uuid),
  app.can_post_to(text, public.app_role[], uuid) to authenticated;
