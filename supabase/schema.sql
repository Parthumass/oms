-- =====================================================================
-- Pratyagra Operations Portal: database schema and access rules
-- Run once in a new Supabase project: SQL Editor -> paste -> Run.
--
-- Roles
--   admin        everything, including setup and user accounts
--   board        all operational data (read and write), no user management
--   centre_lead  one centre
--   volunteer    only the classes and students assigned to them
--   partner      read-only attendance and assessments for their centre/program
--
-- A signed-up user with no role ("pending") can see nothing.
-- =====================================================================

create schema if not exists app;

create type public.app_role   as enum ('admin','board','centre_lead','volunteer','partner');
create type public.att_status as enum ('X','AB');            -- X = present, AB = absent
create type public.exam_type  as enum
  ('Baseline Written','Baseline Oral','Monthly','Midline','Endline Written','Endline Oral');

-- ---------------------------------------------------------------------
-- Setup tables
-- ---------------------------------------------------------------------
create table public.centres (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code ~ '^[A-Z0-9]{2,6}$'),
  name       text not null,
  city       text,
  state      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.programs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.partners (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- What a partner may see. A row with only a centre = everything at that
-- centre; only a program = that program everywhere; both = the overlap.
create table public.partner_scopes (
  id         uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners on delete cascade,
  centre_id  uuid references public.centres on delete cascade,
  program_id uuid references public.programs on delete cascade,
  check (centre_id is not null or program_id is not null)
);

-- ---------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------
create table public.volunteers (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,
  full_name     text not null,
  email         text,
  phone         text,
  centre_id     uuid references public.centres,          -- home centre (optional)
  status        text not null default 'Active' check (status in ('Active','Inactive')),
  verified      boolean not null default false,
  date_joined   date not null default current_date,
  inactive_date date,
  gender        text check (gender in ('Male','Female','Other')),
  education     text,
  occupation    text,
  company       text,
  volunteer_type text,
  subject_pref  text,
  class_pref    text,
  location      text,
  notes         text,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);

create table public.students (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,
  full_name       text not null,
  centre_id       uuid not null references public.centres,
  gender          text check (gender in ('Male','Female','Other')),
  standard        text,
  status          text not null default 'Active' check (status in ('Active','Inactive')),
  verified        boolean not null default false,
  date_joined     date not null default current_date,
  inactive_date   date,
  inactive_reason text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);

-- Family and contact details live in a separate table so that volunteers
-- and partners, who can see a student's name, never see these.
create table public.student_contacts (
  student_id      uuid primary key references public.students on delete cascade,
  date_of_birth   date,
  guardian1_name  text,
  guardian1_phone text,
  guardian2_name  text,
  guardian2_phone text,
  school_name     text,
  medium          text,
  address         text,
  consent_signed  boolean not null default false,
  notes           text
);

-- One row per login. Created automatically when someone signs up.
create table public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  email        text not null,
  full_name    text,
  role         public.app_role,                           -- null = pending
  centre_id    uuid references public.centres,
  partner_id   uuid references public.partners,
  volunteer_id uuid unique references public.volunteers,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  check (role is distinct from 'centre_lead' or centre_id is not null),
  check (role is distinct from 'volunteer'   or volunteer_id is not null),
  check (role is distinct from 'partner'     or partner_id is not null)
);

-- Pre-approved emails. When that person signs up they get this role.
create table public.invites (
  email        text primary key check (email = lower(email)),
  full_name    text,
  role         public.app_role not null,
  centre_id    uuid references public.centres on delete cascade,
  partner_id   uuid references public.partners on delete cascade,
  volunteer_id uuid unique references public.volunteers on delete cascade,
  invited_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  check (role <> 'centre_lead' or centre_id is not null),
  check (role <> 'volunteer'   or volunteer_id is not null),
  check (role <> 'partner'     or partner_id is not null)
);

-- ---------------------------------------------------------------------
-- Classes (the student-volunteer mapping), attendance, assessments
-- ---------------------------------------------------------------------
create table public.classes (
  id           uuid primary key default gen_random_uuid(),
  centre_id    uuid not null references public.centres,
  program_id   uuid not null references public.programs,
  name         text not null,
  subject      text,
  class_type   text check (class_type in ('Morning','Afternoon','Evening')),
  mode         text not null default 'Online' check (mode in ('Online','Offline')),
  volunteer_id uuid references public.volunteers,
  start_date   date not null default current_date,
  end_date     date,
  weekdays     smallint[] not null default '{}',          -- 0 = Sunday ... 6 = Saturday
  duration_min integer not null default 60 check (duration_min between 5 and 600),
  active       boolean not null default true,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);

create table public.class_students (
  class_id   uuid not null references public.classes on delete cascade,
  student_id uuid not null references public.students on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (class_id, student_id)
);

-- One row per class actually held. These are the date columns of the grid.
create table public.sessions (
  id           uuid primary key default gen_random_uuid(),
  class_id     uuid not null references public.classes on delete cascade,
  session_date date not null,
  mode         text check (mode in ('Online','Offline')),
  duration_min integer check (duration_min between 5 and 600),
  topics       text,
  notes        text,
  taught_by    uuid references public.volunteers,         -- set only for a substitute
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  unique (class_id, session_date)
);

create table public.attendance (
  session_id uuid not null references public.sessions on delete cascade,
  student_id uuid not null references public.students on delete cascade,
  status     public.att_status not null,
  marked_by  uuid default auth.uid(),
  marked_at  timestamptz not null default now(),
  primary key (session_id, student_id)
);

create table public.assessments (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes on delete cascade,
  exam_type   public.exam_type not null,
  assess_date date not null default current_date,
  mode        text check (mode in ('Online','Offline')),
  topics      text,
  remarks     text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

create table public.assessment_scores (
  assessment_id uuid not null references public.assessments on delete cascade,
  student_id    uuid not null references public.students on delete cascade,
  pct           numeric(5,2) not null check (pct between 0 and 100),
  remarks       text,
  primary key (assessment_id, student_id)
);

-- Behaviour rating: ten traits scored 1-4, overall out of 10.
create table public.holistic_assessments (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.students on delete cascade,
  volunteer_id uuid references public.volunteers,
  assess_date  date not null default current_date,
  kind         text not null check (kind in ('Baseline','Endline')),
  ratings      jsonb not null default '{}',
  overall      smallint check (overall between 0 and 10),
  feedback     text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Volunteer training, events, other volunteer time, monthly checklist
-- ---------------------------------------------------------------------
create table public.training_topics (
  id      uuid primary key default gen_random_uuid(),
  name    text not null unique,
  is_core boolean not null default false,
  sort    integer not null default 0,
  active  boolean not null default true
);

create table public.training_sessions (
  id           uuid primary key default gen_random_uuid(),
  topic_id     uuid references public.training_topics,
  title        text not null,
  session_date date not null,
  centre_id    uuid references public.centres,            -- null = whole organisation
  kind         text not null default 'Monthly' check (kind in ('Core','Monthly','Other')),
  mode         text check (mode in ('Online','Offline')),
  duration_min integer check (duration_min between 5 and 600),
  description  text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);

create table public.training_attendance (
  session_id   uuid not null references public.training_sessions on delete cascade,
  volunteer_id uuid not null references public.volunteers on delete cascade,
  marked_by    uuid default auth.uid(),
  marked_at    timestamptz not null default now(),
  primary key (session_id, volunteer_id)
);

create table public.training_feedback (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.training_sessions on delete cascade,
  volunteer_id uuid not null references public.volunteers on delete cascade,
  relevance    smallint check (relevance between 1 and 5),
  content      smallint check (content between 1 and 5),
  space        smallint check (space between 1 and 5),
  pace         smallint check (pace between 1 and 5),
  overall      smallint check (overall between 1 and 5),
  takeaways    text,
  apply_plan   text,
  comments     text,
  created_at   timestamptz not null default now(),
  unique (session_id, volunteer_id)
);

create table public.events (
  id           uuid primary key default gen_random_uuid(),
  centre_id    uuid not null references public.centres,
  event_date   date not null,
  name         text not null,
  duration_min integer check (duration_min between 5 and 1440),
  sdg          text,
  outcome      text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);

create table public.event_students (
  event_id   uuid not null references public.events on delete cascade,
  student_id uuid not null references public.students on delete cascade,
  primary key (event_id, student_id)
);

create table public.event_volunteers (
  event_id     uuid not null references public.events on delete cascade,
  volunteer_id uuid not null references public.volunteers on delete cascade,
  primary key (event_id, volunteer_id)
);

create table public.non_teaching_logs (
  id           uuid primary key default gen_random_uuid(),
  volunteer_id uuid not null references public.volunteers on delete cascade,
  log_date     date not null default current_date,
  topic        text not null,
  description  text,
  duration_min integer not null check (duration_min between 5 and 600),
  created_at   timestamptz not null default now()
);

create table public.monthly_checklists (
  id         uuid primary key default gen_random_uuid(),
  centre_id  uuid not null references public.centres,
  month      date not null check (extract(day from month) = 1),
  items      jsonb not null default '{}',                 -- { "item key": "Yes" | "No" | "NA" }
  notes      text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (centre_id, month)
);

create index on public.students (centre_id);
create index on public.classes (centre_id);
create index on public.classes (volunteer_id);
create index on public.class_students (student_id);
create index on public.sessions (taught_by);
create index on public.attendance (student_id);
create index on public.assessments (class_id);
create index on public.assessment_scores (student_id);
create index on public.holistic_assessments (student_id);

-- ---------------------------------------------------------------------
-- Helper functions used by the access rules.
-- They live in the "app" schema, which the API does not expose.
-- ---------------------------------------------------------------------
create function app.my_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid()) and active
$$;

create function app.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.my_role() = 'admin', false)
$$;

create function app.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.my_role() in ('admin','board'), false)
$$;

create function app.my_centre() returns uuid
language sql stable security definer set search_path = '' as $$
  select centre_id from public.profiles
  where id = (select auth.uid()) and active and role = 'centre_lead'
$$;

create function app.my_volunteer() returns uuid
language sql stable security definer set search_path = '' as $$
  select volunteer_id from public.profiles
  where id = (select auth.uid()) and active and role = 'volunteer'
$$;

create function app.my_partner() returns uuid
language sql stable security definer set search_path = '' as $$
  select partner_id from public.profiles
  where id = (select auth.uid()) and active and role = 'partner'
$$;

create function app.is_lead_of(centre uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(centre = app.my_centre(), false)
$$;

-- Home centre of a volunteer login (used for trainings and events).
create function app.my_home_centre() returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(app.my_centre(),
                  (select centre_id from public.volunteers where id = app.my_volunteer()))
$$;

create function app.class_centre(cls uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select centre_id from public.classes where id = cls
$$;

create function app.student_centre(stu uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select centre_id from public.students where id = stu
$$;

create function app.volunteer_centre(vol uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select centre_id from public.volunteers where id = vol
$$;

create function app.session_class(ses uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select class_id from public.sessions where id = ses
$$;

create function app.assessment_class(asm uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select class_id from public.assessments where id = asm
$$;

create function app.event_centre(ev uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select centre_id from public.events where id = ev
$$;

create function app.training_centre(ts uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select centre_id from public.training_sessions where id = ts
$$;

-- The volunteer assigned to the class.
create function app.is_class_volunteer(cls uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.classes c
                 where c.id = cls and c.volunteer_id = app.my_volunteer())
$$;

-- Assigned volunteer, or someone who has covered a session as a substitute.
create function app.teaches_class(cls uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_class_volunteer(cls)
      or exists (select 1 from public.sessions s
                 where s.class_id = cls and s.taught_by = app.my_volunteer())
$$;

create function app.teaches_student(stu uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.class_students cs
                 where cs.student_id = stu and app.teaches_class(cs.class_id))
$$;

-- May fill in this session: the class volunteer, or the named substitute.
create function app.can_mark_session(ses uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sessions s
                 where s.id = ses
                   and (app.is_class_volunteer(s.class_id) or s.taught_by = app.my_volunteer()))
$$;

create function app.session_has_student(ses uuid, stu uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sessions s
                 join public.class_students cs on cs.class_id = s.class_id
                 where s.id = ses and cs.student_id = stu)
$$;

create function app.class_has_student(cls uuid, stu uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.class_students cs
                 where cs.class_id = cls and cs.student_id = stu)
$$;

create function app.partner_sees_class(cls uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.classes c
                 join public.partner_scopes ps on ps.partner_id = app.my_partner()
                 where c.id = cls
                   and (ps.centre_id  is null or ps.centre_id  = c.centre_id)
                   and (ps.program_id is null or ps.program_id = c.program_id))
$$;

create function app.partner_sees_student(stu uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.class_students cs
                 where cs.student_id = stu and app.partner_sees_class(cs.class_id))
      or exists (select 1 from public.students s
                 join public.partner_scopes ps on ps.partner_id = app.my_partner()
                 where s.id = stu and ps.program_id is null and ps.centre_id = s.centre_id)
$$;

-- Read access to anything that hangs off a class.
create function app.can_read_class(cls uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_staff()
      or app.is_lead_of(app.class_centre(cls))
      or app.teaches_class(cls)
      or app.partner_sees_class(cls)
$$;

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
create table app.counters (key text primary key, last integer not null);
alter table app.counters enable row level security;   -- no policies: only the trigger below can use it

-- Student and volunteer codes, e.g. BPL0001S / BPL0001V (PEF... when no centre).
create function app.assign_code() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  prefix text;
  n integer;
begin
  if coalesce(new.code, '') <> '' then return new; end if;
  select code into prefix from public.centres where id = new.centre_id;
  prefix := coalesce(prefix, 'PEF');
  insert into app.counters (key, last) values (prefix || tg_argv[0], 1)
    on conflict (key) do update set last = app.counters.last + 1
    returning last into n;
  new.code := prefix || lpad(n::text, 4, '0') || tg_argv[0];
  return new;
end $$;

create trigger students_code before insert on public.students
  for each row execute function app.assign_code('S');
create trigger volunteers_code before insert on public.volunteers
  for each row execute function app.assign_code('V');

-- New sign-up: create the profile, taking the role from a matching invite.
create function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  inv public.invites;
  nm  text := nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');
begin
  select * into inv from public.invites where email = lower(new.email);
  if found then
    begin
      insert into public.profiles (id, email, full_name, role, centre_id, partner_id, volunteer_id)
      values (new.id, lower(new.email), coalesce(inv.full_name, nm),
              inv.role, inv.centre_id, inv.partner_id, inv.volunteer_id);
      delete from public.invites where email = inv.email;
      return new;
    exception when others then
      null;                                   -- fall through to a pending profile
    end;
  end if;
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(new.email), nm)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- Invite added for someone who already signed up and is still pending.
create function app.apply_invite() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles p
     set role = new.role, centre_id = new.centre_id, partner_id = new.partner_id,
         volunteer_id = new.volunteer_id, full_name = coalesce(new.full_name, p.full_name)
   where p.email = new.email and p.role is null;
  if found then
    delete from public.invites where email = new.email;
  end if;
  return null;
end $$;

create trigger invites_apply after insert on public.invites
  for each row execute function app.apply_invite();

-- Marking a volunteer inactive also switches off their login.
create function app.sync_volunteer_login() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    update public.profiles set active = (new.status = 'Active') where volunteer_id = new.id;
  end if;
  return new;
end $$;

create trigger volunteers_login after update on public.volunteers
  for each row execute function app.sync_volunteer_login();

-- ---------------------------------------------------------------------
-- Access rules (row-level security)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Setup tables: everyone with a role can read names; only admin edits.
create policy read  on public.centres  for select to authenticated using ((select app.my_role()) is not null);
create policy admin on public.centres  for all    to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));
create policy read  on public.programs for select to authenticated using ((select app.my_role()) is not null);
create policy admin on public.programs for all    to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));

create policy read  on public.partners for select to authenticated
  using ((select app.is_staff()) or id = (select app.my_partner()));
create policy admin on public.partners for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
create policy read  on public.partner_scopes for select to authenticated
  using ((select app.is_staff()) or partner_id = (select app.my_partner()));
create policy admin on public.partner_scopes for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- Logins
create policy read on public.profiles for select to authenticated
  using (id = (select auth.uid())
      or (select app.is_staff())
      or ((select app.my_role()) = 'centre_lead' and role = 'volunteer'));
create policy admin_update on public.profiles for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
create policy admin_delete on public.profiles for delete to authenticated
  using ((select app.is_admin()));

create policy admin on public.invites for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
create policy lead on public.invites for all to authenticated
  using      (role = 'volunteer' and app.is_lead_of(app.volunteer_centre(volunteer_id)))
  with check (role = 'volunteer' and centre_id is null and partner_id is null
              and app.is_lead_of(app.volunteer_centre(volunteer_id)));

-- Volunteers
create policy read on public.volunteers for select to authenticated
  using ((select app.is_staff())
      or (select app.my_role()) = 'centre_lead'
      or id = (select app.my_volunteer()));
create policy ins on public.volunteers for insert to authenticated
  with check ((select app.is_staff()) or app.is_lead_of(centre_id));
create policy upd on public.volunteers for update to authenticated
  using      ((select app.is_staff()) or app.is_lead_of(centre_id))
  with check ((select app.is_staff()) or app.is_lead_of(centre_id));
create policy del on public.volunteers for delete to authenticated
  using ((select app.is_admin()));

-- Students
create policy read on public.students for select to authenticated
  using ((select app.is_staff())
      or app.is_lead_of(centre_id)
      or app.teaches_student(id)
      or app.partner_sees_student(id));
create policy ins on public.students for insert to authenticated
  with check ((select app.is_staff()) or app.is_lead_of(centre_id));
create policy upd on public.students for update to authenticated
  using      ((select app.is_staff()) or app.is_lead_of(centre_id))
  with check ((select app.is_staff()) or app.is_lead_of(centre_id));
create policy del on public.students for delete to authenticated
  using ((select app.is_admin()));

create policy manage on public.student_contacts for all to authenticated
  using      ((select app.is_staff()) or app.is_lead_of(app.student_centre(student_id)))
  with check ((select app.is_staff()) or app.is_lead_of(app.student_centre(student_id)));

-- Classes and rosters
create policy read on public.classes for select to authenticated
  using (app.can_read_class(id));
create policy manage on public.classes for all to authenticated
  using      ((select app.is_staff()) or app.is_lead_of(centre_id))
  with check ((select app.is_staff()) or app.is_lead_of(centre_id));

create policy read on public.class_students for select to authenticated
  using (app.can_read_class(class_id));
create policy manage on public.class_students for all to authenticated
  using      ((select app.is_staff()) or app.is_lead_of(app.class_centre(class_id)))
  with check ((select app.is_staff())
           or (app.is_lead_of(app.class_centre(class_id))
               and app.is_lead_of(app.student_centre(student_id))));

-- Sessions and attendance
create policy read on public.sessions for select to authenticated
  using (app.can_read_class(class_id));
create policy ins on public.sessions for insert to authenticated
  with check ((select app.is_staff())
           or app.is_lead_of(app.class_centre(class_id))
           or (app.is_class_volunteer(class_id) and taught_by is null));
create policy upd on public.sessions for update to authenticated
  using      ((select app.is_staff())
           or app.is_lead_of(app.class_centre(class_id))
           or app.can_mark_session(id))
  with check ((select app.is_staff())
           or app.is_lead_of(app.class_centre(class_id))
           or app.can_mark_session(id));
create policy del on public.sessions for delete to authenticated
  using ((select app.is_staff()) or app.is_lead_of(app.class_centre(class_id)));

create policy read on public.attendance for select to authenticated
  using (app.can_read_class(app.session_class(session_id)));
create policy manage on public.attendance for all to authenticated
  using      ((select app.is_staff())
           or app.is_lead_of(app.class_centre(app.session_class(session_id)))
           or app.can_mark_session(session_id))
  with check (app.session_has_student(session_id, student_id)
          and ((select app.is_staff())
           or app.is_lead_of(app.class_centre(app.session_class(session_id)))
           or app.can_mark_session(session_id)));

-- Assessments
create policy read on public.assessments for select to authenticated
  using (app.can_read_class(class_id));
create policy manage on public.assessments for all to authenticated
  using      ((select app.is_staff())
           or app.is_lead_of(app.class_centre(class_id))
           or app.is_class_volunteer(class_id))
  with check ((select app.is_staff())
           or app.is_lead_of(app.class_centre(class_id))
           or app.is_class_volunteer(class_id));

create policy read on public.assessment_scores for select to authenticated
  using (app.can_read_class(app.assessment_class(assessment_id)));
create policy manage on public.assessment_scores for all to authenticated
  using      ((select app.is_staff())
           or app.is_lead_of(app.class_centre(app.assessment_class(assessment_id)))
           or app.is_class_volunteer(app.assessment_class(assessment_id)))
  with check (app.class_has_student(app.assessment_class(assessment_id), student_id)
          and ((select app.is_staff())
           or app.is_lead_of(app.class_centre(app.assessment_class(assessment_id)))
           or app.is_class_volunteer(app.assessment_class(assessment_id))));

create policy read on public.holistic_assessments for select to authenticated
  using ((select app.is_staff())
      or app.is_lead_of(app.student_centre(student_id))
      or volunteer_id = (select app.my_volunteer()));
create policy manage on public.holistic_assessments for all to authenticated
  using      ((select app.is_staff())
           or app.is_lead_of(app.student_centre(student_id))
           or (volunteer_id = (select app.my_volunteer()) and app.teaches_student(student_id)))
  with check ((select app.is_staff())
           or app.is_lead_of(app.student_centre(student_id))
           or (volunteer_id = (select app.my_volunteer()) and app.teaches_student(student_id)));

-- Training
create policy read on public.training_topics for select to authenticated
  using ((select app.my_role()) in ('admin','board','centre_lead','volunteer'));
create policy manage on public.training_topics for all to authenticated
  using ((select app.is_staff())) with check ((select app.is_staff()));

create policy read on public.training_sessions for select to authenticated
  using ((select app.is_staff())
      or ((select app.my_role()) in ('centre_lead','volunteer')
          and (centre_id is null or centre_id = (select app.my_home_centre()))));
create policy manage on public.training_sessions for all to authenticated
  using      ((select app.is_staff()) or app.is_lead_of(centre_id))
  with check ((select app.is_staff()) or app.is_lead_of(centre_id));

create policy read on public.training_attendance for select to authenticated
  using ((select app.is_staff())
      or volunteer_id = (select app.my_volunteer())
      or app.is_lead_of(app.volunteer_centre(volunteer_id))
      or app.is_lead_of(app.training_centre(session_id)));
create policy manage on public.training_attendance for all to authenticated
  using      ((select app.is_staff())
           or app.is_lead_of(app.volunteer_centre(volunteer_id))
           or app.is_lead_of(app.training_centre(session_id)))
  with check ((select app.is_staff())
           or app.is_lead_of(app.volunteer_centre(volunteer_id))
           or app.is_lead_of(app.training_centre(session_id)));

create policy read on public.training_feedback for select to authenticated
  using ((select app.is_staff())
      or volunteer_id = (select app.my_volunteer())
      or app.is_lead_of(app.volunteer_centre(volunteer_id)));
create policy own on public.training_feedback for all to authenticated
  using      (volunteer_id = (select app.my_volunteer()))
  with check (volunteer_id = (select app.my_volunteer()));

-- Events
create policy read on public.events for select to authenticated
  using ((select app.is_staff())
      or app.is_lead_of(centre_id)
      or ((select app.my_role()) = 'volunteer' and centre_id = (select app.my_home_centre())));
create policy manage on public.events for all to authenticated
  using      ((select app.is_staff()) or app.is_lead_of(centre_id))
  with check ((select app.is_staff()) or app.is_lead_of(centre_id));

create policy manage on public.event_students for all to authenticated
  using      ((select app.is_staff()) or app.is_lead_of(app.event_centre(event_id)))
  with check ((select app.is_staff()) or app.is_lead_of(app.event_centre(event_id)));
create policy manage on public.event_volunteers for all to authenticated
  using      ((select app.is_staff()) or app.is_lead_of(app.event_centre(event_id)))
  with check ((select app.is_staff()) or app.is_lead_of(app.event_centre(event_id)));
create policy own on public.event_volunteers for select to authenticated
  using (volunteer_id = (select app.my_volunteer()));

-- Other volunteer time
create policy read on public.non_teaching_logs for select to authenticated
  using ((select app.is_staff())
      or volunteer_id = (select app.my_volunteer())
      or app.is_lead_of(app.volunteer_centre(volunteer_id)));
create policy manage on public.non_teaching_logs for all to authenticated
  using      ((select app.is_staff())
           or volunteer_id = (select app.my_volunteer())
           or app.is_lead_of(app.volunteer_centre(volunteer_id)))
  with check ((select app.is_staff())
           or volunteer_id = (select app.my_volunteer())
           or app.is_lead_of(app.volunteer_centre(volunteer_id)));

-- Monthly checklist
create policy manage on public.monthly_checklists for all to authenticated
  using      ((select app.is_staff()) or app.is_lead_of(centre_id))
  with check ((select app.is_staff()) or app.is_lead_of(centre_id));

-- ---------------------------------------------------------------------
-- Report views. security_invoker makes them obey the rules above.
-- ---------------------------------------------------------------------
create view public.attendance_summary with (security_invoker = true) as
select s.class_id,
       a.student_id,
       count(*)                                   as marked,
       count(*) filter (where a.status = 'X')     as present,
       round(100.0 * count(*) filter (where a.status = 'X') / count(*), 1) as pct
from public.attendance a
join public.sessions s on s.id = a.session_id
group by s.class_id, a.student_id;

create view public.assessment_summary with (security_invoker = true) as
select a.class_id,
       a.exam_type,
       count(*)                 as scores,
       round(avg(sc.pct), 1)    as avg_pct
from public.assessments a
join public.assessment_scores sc on sc.assessment_id = a.id
group by a.class_id, a.exam_type;

create view public.volunteer_hours with (security_invoker = true) as
select v.id as volunteer_id, v.code, v.full_name, v.centre_id, v.status,
       coalesce(t.n, 0)     as classes_taken,
       coalesce(t.mins, 0)  as teaching_min,
       coalesce(e.n, 0)     as events_attended,
       coalesce(e.mins, 0)  as event_min,
       coalesce(n.mins, 0)  as other_min,
       coalesce(tr.n, 0)    as trainings_attended,
       coalesce(tr.core, 0) as core_trainings_done
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
  select count(*) as n,
         count(distinct ts.topic_id) filter (where tt.is_core) as core
  from public.training_attendance ta
  join public.training_sessions ts on ts.id = ta.session_id
  left join public.training_topics tt on tt.id = ts.topic_id
  where ta.volunteer_id = v.id
) tr on true;

-- ---------------------------------------------------------------------
-- Privileges. Nothing is available without signing in.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;
revoke all on app.counters from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Starting data. Edit freely in the portal afterwards.
-- ---------------------------------------------------------------------
insert into public.training_topics (name, is_core, sort) values
  ('Core training 1', true, 1), ('Core training 2', true, 2), ('Core training 3', true, 3),
  ('Core training 4', true, 4), ('Core training 5', true, 5);
