-- =====================================================================
-- 005: tasks. Assign a piece of work to any login (a social media post,
-- a report, a lesson plan); the person adds notes, links and files and
-- submits it; whoever assigned it reviews. Run after 004. Safe to re-run.
--
-- Who can assign:  admin and board -> anyone with a login
--                  centre lead     -> volunteer logins of their own centre
-- Who can see a task: the person it is assigned to, whoever assigned it,
-- and the admin team and board.
-- Files live in the private storage bucket "task-files", one folder per task.
-- =====================================================================

create table if not exists public.tasks (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  details          text,
  category         text not null default 'General' check (category in ('Social media','Program','General')),
  assignee         uuid not null references public.profiles on delete cascade,
  assignee_name    text,
  assigned_by      uuid default auth.uid() references public.profiles on delete set null,
  assigned_by_name text,
  due_date         date,
  status           text not null default 'To do' check (status in ('To do','Submitted','Changes needed','Done')),
  feedback         text,
  submitted_at     timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists tasks_assignee_idx on public.tasks (assignee);

-- Everything added to a task: a note, a link, a file, or any mix.
create table if not exists public.task_updates (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks on delete cascade,
  author      uuid default auth.uid() references public.profiles on delete set null,
  author_name text,
  note        text,
  link        text,
  file_path   text,
  file_name   text,
  file_size   bigint,
  created_at  timestamptz not null default now(),
  check (note is not null or link is not null or file_path is not null)
);
create index if not exists task_updates_task_idx on public.task_updates (task_id);

alter table public.tasks enable row level security;
alter table public.task_updates enable row level security;

create or replace function app.can_manage_task(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_staff()
      or exists (select 1 from public.tasks t where t.id = p_task and t.assigned_by = (select auth.uid())
                 and app.my_role() is not null)
$$;

create or replace function app.can_see_task(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.can_manage_task(p_task)
      or exists (select 1 from public.tasks t where t.id = p_task and t.assignee = (select auth.uid())
                 and app.my_role() is not null)
$$;

-- May the signed-in person give a task to this login?
create or replace function app.can_assign_to(p_assignee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                 where p.id = p_assignee and p.active and p.role is not null
                   and (app.is_staff()
                        or (p.role = 'volunteer' and app.is_lead_of(app.volunteer_centre(p.volunteer_id)))))
$$;

-- "<task id>/<file>" -> task id, or null if the path is not shaped like that.
create or replace function app.task_from_path(p_name text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end $$;

drop policy if exists read on public.tasks;
create policy read on public.tasks for select to authenticated
  using ((select app.is_staff())
      or ((select app.my_role()) is not null and (assignee = (select auth.uid()) or assigned_by = (select auth.uid()))));
drop policy if exists ins on public.tasks;
create policy ins on public.tasks for insert to authenticated
  with check (assigned_by = (select auth.uid()) and status = 'To do' and app.can_assign_to(assignee));
drop policy if exists upd on public.tasks;
create policy upd on public.tasks for update to authenticated
  using (app.can_manage_task(id))
  with check (app.can_manage_task(id) and app.can_assign_to(assignee));
drop policy if exists del on public.tasks;
create policy del on public.tasks for delete to authenticated
  using (app.can_manage_task(id));

drop policy if exists read on public.task_updates;
create policy read on public.task_updates for select to authenticated
  using (app.can_see_task(task_id));
drop policy if exists ins on public.task_updates;
create policy ins on public.task_updates for insert to authenticated
  with check (author = (select auth.uid()) and app.can_see_task(task_id));
drop policy if exists del on public.task_updates;
create policy del on public.task_updates for delete to authenticated
  using ((select app.is_staff()) or (author = (select auth.uid()) and app.can_see_task(task_id)));

-- The person doing the task hands it in. They cannot change anything else about it.
create or replace function public.submit_task(p_task uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.tasks set status = 'Submitted', submitted_at = now()
   where id = p_task and assignee = (select auth.uid()) and status in ('To do','Changes needed')
     and app.my_role() is not null;
  if not found then
    raise exception 'This task cannot be submitted.';
  end if;
end $$;

revoke all on public.tasks, public.task_updates from anon;
grant select, insert, update, delete on public.tasks, public.task_updates to authenticated;
revoke all on function public.submit_task(uuid) from public, anon;
grant execute on function public.submit_task(uuid) to authenticated;
grant execute on function app.can_manage_task(uuid), app.can_see_task(uuid), app.can_assign_to(uuid), app.task_from_path(text) to authenticated;

-- Files: a private bucket, 20 MB per file. Access follows the task.
insert into storage.buckets (id, name, public, file_size_limit)
values ('task-files', 'task-files', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = 20971520;

drop policy if exists "task files read" on storage.objects;
create policy "task files read" on storage.objects for select to authenticated
  using (bucket_id = 'task-files' and app.can_see_task(app.task_from_path(name)));
drop policy if exists "task files add" on storage.objects;
create policy "task files add" on storage.objects for insert to authenticated
  with check (bucket_id = 'task-files' and app.can_see_task(app.task_from_path(name)));
drop policy if exists "task files remove" on storage.objects;
create policy "task files remove" on storage.objects for delete to authenticated
  using (bucket_id = 'task-files'
     and (app.can_manage_task(app.task_from_path(name))
          or (owner_id = (select auth.uid())::text and app.can_see_task(app.task_from_path(name)))));
