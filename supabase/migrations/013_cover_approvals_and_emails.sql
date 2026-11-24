-- =====================================================================
-- 013: handing over a class date now needs two yeses, and sends emails.
-- Run after 012. Safe to re-run.
--
--   1. A teacher of the class (or the centre lead) asks another teacher.
--   2. That teacher accepts or declines.
--   3. The centre lead approves or declines. (Skipped when the centre
--      lead or admin team made the request themselves.)
-- Only then does the class date move to the other teacher.
--
-- Emails go out at each step with the next hourly run, and waiting
-- requests are listed in the daily summary. The daily summary also now
-- shows today's classes to extra teachers and to whoever is covering.
-- =====================================================================

alter table public.mail_settings add column if not exists cover_emails boolean not null default true;

create table if not exists public.class_cover_requests (
  id                uuid primary key default gen_random_uuid(),
  class_id          uuid not null references public.classes on delete cascade,
  class_name        text,
  cover_date        date not null,
  volunteer_id      uuid not null references public.volunteers on delete cascade,   -- who is asked to take it
  volunteer_name    text,
  requested_by      uuid references public.profiles on delete set null,
  requested_by_name text,
  note              text,
  lead_made_it      boolean not null default false,
  status            text not null default 'Waiting for teacher'
                    check (status in ('Waiting for teacher','Waiting for centre lead','Approved','Declined','Cancelled')),
  declined_by       text,
  decline_note      text,
  teacher_answered_at timestamptz,
  decided_by        uuid,
  decided_by_name   text,
  decided_at        timestamptz,
  created_at        timestamptz not null default now()
);
create unique index if not exists class_cover_requests_one_open on public.class_cover_requests (class_id, cover_date)
  where status in ('Waiting for teacher','Waiting for centre lead','Approved');
create index if not exists class_cover_requests_volunteer_idx on public.class_cover_requests (volunteer_id);
alter table public.class_cover_requests enable row level security;

drop policy if exists read on public.class_cover_requests;
create policy read on public.class_cover_requests for select to authenticated
  using ((select app.is_staff())
      or app.is_lead_of(app.class_centre(class_id))
      or requested_by = (select auth.uid())
      or volunteer_id = (select app.my_volunteer()));
revoke all on public.class_cover_requests from anon, authenticated;
grant select on public.class_cover_requests to authenticated;

-- A hand-over now only happens through the steps below.
drop policy if exists ins on public.class_covers;
drop policy if exists del on public.class_covers;
create policy del on public.class_covers for delete to authenticated
  using ((select app.is_staff()) or app.is_lead_of(app.class_centre(class_id)));
drop function if exists public.give_cover(uuid, date, uuid, text);

-- People a class can be handed to: active volunteers of the class's
-- centre (or with no centre yet) who have a login, so they can answer.
create or replace function public.cover_candidates(p_class uuid)
returns table (id uuid, full_name text, code text)
language sql stable security definer set search_path = '' as $$
  select v.id, v.full_name, v.code
    from public.volunteers v
    join public.classes c on c.id = p_class
   where v.status = 'Active'
     and (v.centre_id = c.centre_id or v.centre_id is null
          or exists (select 1 from public.class_teachers t where t.class_id = c.id and t.volunteer_id = v.id))
     and exists (select 1 from public.profiles p where p.volunteer_id = v.id and p.active and p.role is not null)
     and v.id is distinct from app.my_volunteer()
     and (app.is_staff() or app.is_lead_of(c.centre_id) or app.is_class_volunteer(c.id))
   order by v.full_name
$$;

create or replace function app.my_name() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(trim(full_name), ''), split_part(email, '@', 1)) from public.profiles where id = (select auth.uid())
$$;

-- Step 1: ask another teacher to take the class on a date.
create or replace function public.request_cover(p_class uuid, p_date date, p_volunteer uuid, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_name text; c_name text; boss boolean;
begin
  boss := app.is_staff() or app.is_lead_of(app.class_centre(p_class));
  if not (boss or app.is_class_volunteer(p_class)) then
    raise exception 'Only a teacher of this class or the centre lead can hand it over.';
  end if;
  if p_date < current_date - 1 then raise exception 'Choose today or a later date.'; end if;
  select full_name into v_name from public.cover_candidates(p_class) where id = p_volunteer;
  if v_name is null then raise exception 'Choose an active volunteer of this centre who has a login.'; end if;
  if exists (select 1 from public.class_cover_requests r where r.class_id = p_class and r.cover_date = p_date
             and r.status in ('Waiting for teacher','Waiting for centre lead','Approved')) then
    raise exception 'This class already has a hand-over for that date. Cancel it first.';
  end if;
  select name into c_name from public.classes where id = p_class;
  insert into public.class_cover_requests (class_id, class_name, cover_date, volunteer_id, volunteer_name,
                                           requested_by, requested_by_name, note, lead_made_it)
  values (p_class, c_name, p_date, p_volunteer, v_name, (select auth.uid()), app.my_name(), nullif(trim(p_note), ''), boss)
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.apply_cover(r public.class_cover_requests) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.class_covers (class_id, cover_date, volunteer_id, volunteer_name, given_by, given_by_name, note)
  values (r.class_id, r.cover_date, r.volunteer_id, r.volunteer_name, r.requested_by, r.requested_by_name, r.note)
  on conflict (class_id, cover_date) do update
    set volunteer_id = excluded.volunteer_id, volunteer_name = excluded.volunteer_name,
        given_by = excluded.given_by, given_by_name = excluded.given_by_name, note = excluded.note;
end $$;

-- Step 2: the teacher who was asked says yes or no.
create or replace function public.answer_cover(p_request uuid, p_accept boolean, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.class_cover_requests;
begin
  select * into r from public.class_cover_requests where id = p_request for update;
  if not found or r.volunteer_id is distinct from app.my_volunteer() then raise exception 'This request is not for you.'; end if;
  if r.status <> 'Waiting for teacher' then raise exception 'This request has already been answered.'; end if;
  if not p_accept then
    update public.class_cover_requests set status = 'Declined', declined_by = 'teacher', decline_note = nullif(trim(p_note), ''), teacher_answered_at = now() where id = p_request;
    return 'Declined';
  end if;
  if r.lead_made_it then
    update public.class_cover_requests set status = 'Approved', teacher_answered_at = now(), decided_at = now(),
           decided_by = r.requested_by, decided_by_name = r.requested_by_name where id = p_request returning * into r;
    perform app.apply_cover(r);
    return 'Approved';
  end if;
  update public.class_cover_requests set status = 'Waiting for centre lead', teacher_answered_at = now() where id = p_request;
  return 'Waiting for centre lead';
end $$;

-- Step 3: the centre lead (or admin team) approves or declines.
create or replace function public.decide_cover(p_request uuid, p_approve boolean, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.class_cover_requests;
begin
  select * into r from public.class_cover_requests where id = p_request for update;
  if not found or not (app.is_staff() or app.is_lead_of(app.class_centre(r.class_id))) then
    raise exception 'Only the centre lead can approve this.';
  end if;
  if r.status <> 'Waiting for centre lead' then raise exception 'This request is not waiting for approval.'; end if;
  update public.class_cover_requests
     set status = case when p_approve then 'Approved' else 'Declined' end,
         declined_by = case when p_approve then null else 'centre lead' end,
         decline_note = case when p_approve then null else nullif(trim(p_note), '') end,
         decided_by = (select auth.uid()), decided_by_name = app.my_name(), decided_at = now()
   where id = p_request returning * into r;
  if p_approve then perform app.apply_cover(r); end if;
  return r.status;
end $$;

-- Whoever asked (or the centre lead) can call it off, before or after approval.
create or replace function public.cancel_cover(p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.class_cover_requests;
begin
  select * into r from public.class_cover_requests where id = p_request for update;
  if not found or not (r.requested_by = (select auth.uid()) or app.is_staff() or app.is_lead_of(app.class_centre(r.class_id))) then
    raise exception 'Only the person who asked or the centre lead can cancel this.';
  end if;
  if r.status not in ('Waiting for teacher','Waiting for centre lead','Approved') then raise exception 'This is already closed.'; end if;
  if r.status = 'Approved' then
    delete from public.class_covers where class_id = r.class_id and cover_date = r.cover_date and volunteer_id = r.volunteer_id;
  end if;
  update public.class_cover_requests set status = 'Cancelled', decided_at = now() where id = p_request;
end $$;

-- Emails at each step.
create or replace function app.queue_cover_email() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s public.mail_settings;
  what text := coalesce(new.class_name, 'a class') || ' on ' || to_char(new.cover_date, 'Dy DD Mon YYYY');
  subj text; txt text; who uuid; addr text;
  teacher uuid;
begin
  select * into s from public.mail_settings;
  if not (s.enabled and s.cover_emails) then return new; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  select id into teacher from public.profiles where volunteer_id = new.volunteer_id and active limit 1;

  for who, subj, txt in
    select x.who, x.subj, x.txt from (
      -- asked: to the teacher who is asked
      select teacher as who, 'Can you take ' || what || '?' as subj,
             coalesce(new.requested_by_name, 'A teacher') || ' has asked you to take ' || what || '.' ||
             case when new.note is not null then E'\n\nNote: ' || new.note else '' end ||
             E'\n\nPlease accept or decline on your home page.' as txt
       where new.status = 'Waiting for teacher'
      union all
      -- accepted: to the centre leads of the class's centre
      select p.id, 'Class hand-over waiting for your approval',
             coalesce(new.requested_by_name, 'A teacher') || ' wants ' || coalesce(new.volunteer_name, 'another teacher') || ' to take ' || what ||
             '. ' || coalesce(new.volunteer_name, 'They') || E' accepted.\n\nPlease approve or decline on the Classes page.'
        from public.profiles p join public.classes c on c.id = new.class_id
       where new.status = 'Waiting for centre lead' and p.role = 'centre_lead' and p.centre_id = c.centre_id and p.active
      union all
      -- approved: to both teachers
      select y, 'Hand-over approved: ' || what,
             coalesce(new.volunteer_name, 'The other teacher') || ' will take ' || what || '.'
        from unnest(array[teacher, new.requested_by]) y where new.status = 'Approved'
      union all
      -- declined: to the person who asked, and to the other teacher if the centre lead said no
      select y, 'Hand-over declined: ' || what,
             'The request for ' || coalesce(new.volunteer_name, 'another teacher') || ' to take ' || what || ' was declined by the ' || coalesce(new.declined_by, 'centre lead') || '.' ||
             case when new.decline_note is not null then E'\n\nReason: ' || new.decline_note else '' end ||
             E'\n\nThe class stays with its usual teacher.'
        from unnest(array[new.requested_by, case when new.declined_by = 'centre lead' then teacher end]) y where new.status = 'Declined'
      union all
      -- cancelled: to the teacher who was asked
      select teacher, 'Hand-over cancelled: ' || what,
             'You no longer need to take ' || what || '. The class stays with its usual teacher.'
       where new.status = 'Cancelled'
    ) x where x.who is not null and x.who is distinct from (select auth.uid())
  loop
    addr := app.mail_address(who);
    continue when addr is null;
    insert into public.email_outbox (profile_id, to_email, subject, body, kind)
    values (who, addr, 'Pratyagra: ' || subj, txt || E'\n\nOpen the portal: ' || s.portal_url, 'cover');
  end loop;
  return new;
end $$;
drop trigger if exists class_cover_requests_email on public.class_cover_requests;
create trigger class_cover_requests_email after insert or update on public.class_cover_requests
  for each row execute function app.queue_cover_email();

-- Daily summary: classes today for extra teachers and whoever is covering,
-- and hand-overs waiting for an answer or an approval.
create or replace function app.build_digest(p_profile uuid, p_day date) returns text
language plpgsql security definer set search_path = '' as $$
declare
  s public.mail_settings;
  p public.profiles;
  body text := '';
  part text;
  n integer;
  dow integer := extract(dow from p_day)::integer;
  ydow integer := extract(dow from p_day - 1)::integer;
begin
  select * into s from public.mail_settings;
  select * into p from public.profiles where id = p_profile;
  -- look at the portal as this person, so the same visibility rules apply
  perform set_config('request.jwt.claim.sub', p_profile::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_profile, 'role', 'authenticated')::text, true);

  if s.class_reminders and p.volunteer_id is not null then
    select string_agg('  - ' || coalesce(to_char(c.start_time, 'HH24:MI') || ' IST', 'time not set') || '  ' || c.name || ' (' || ce.name || ')', E'\n' order by c.start_time nulls last, c.name)
      into part
      from public.classes c join public.centres ce on ce.id = c.centre_id
     where c.active
       and ((  (c.volunteer_id = p.volunteer_id
                or exists (select 1 from public.class_teachers t where t.class_id = c.id and t.volunteer_id = p.volunteer_id))
             and dow = any (c.weekdays)
             and p_day >= c.start_date and (c.end_date is null or p_day <= c.end_date)
             and not exists (select 1 from public.class_covers k where k.class_id = c.id and k.cover_date = p_day
                             and k.volunteer_id <> p.volunteer_id))
            or exists (select 1 from public.class_covers k where k.class_id = c.id and k.cover_date = p_day
                       and k.volunteer_id = p.volunteer_id));
    if part is not null then body := body || E'YOUR CLASSES TODAY\n' || part || E'\n\n'; end if;
  end if;

  if s.attendance_nudges and p.volunteer_id is not null then
    select string_agg('  - ' || c.name, E'\n' order by c.name) into part
      from public.classes c
     where c.active
       and ((  c.volunteer_id = p.volunteer_id and ydow = any (c.weekdays)
             and p_day - 1 >= c.start_date and (c.end_date is null or p_day - 1 <= c.end_date)
             and not exists (select 1 from public.class_covers k where k.class_id = c.id and k.cover_date = p_day - 1
                             and k.volunteer_id <> p.volunteer_id))
            or exists (select 1 from public.class_covers k where k.class_id = c.id and k.cover_date = p_day - 1
                       and k.volunteer_id = p.volunteer_id))
       and not exists (select 1 from public.sessions se join public.attendance a on a.session_id = se.id
                       where se.class_id = c.id and se.session_date = p_day - 1);
    if part is not null then body := body || E'ATTENDANCE NOT MARKED FOR YESTERDAY\n' || part || E'\n\n'; end if;
  end if;

  if s.task_emails then
    select string_agg('  - ' || t.title || case when t.status = 'Changes needed' then ' (changes asked for)' else '' end
                      || case when t.due_date is null then '' when t.due_date < p_day then ' - OVERDUE since ' || to_char(t.due_date, 'DD Mon')
                              when t.due_date = p_day then ' - due today' else ' - due ' || to_char(t.due_date, 'DD Mon') end,
                      E'\n' order by t.due_date nulls last, t.title) into part
      from public.tasks t
     where t.assignee = p_profile and t.status in ('To do', 'Changes needed')
       and (t.status = 'Changes needed' or (t.due_date is not null and t.due_date <= p_day + 1));
    if part is not null then body := body || E'YOUR TASKS\n' || part || E'\n\n'; end if;
    select count(*) into n from public.tasks t where t.assigned_by = p_profile and t.status = 'Submitted';
    if n > 0 then body := body || 'TASKS WAITING FOR YOUR REVIEW: ' || n || E'\n\n'; end if;
  end if;

  if s.update_emails and p.role <> 'partner' then
    select string_agg('  - ' || a.title, E'\n' order by a.created_at desc) into part
      from public.announcements a
     where a.author is distinct from p_profile
       and a.created_at >= (p_day - 1)::timestamp at time zone 'Asia/Kolkata'
       and app.sees_announcement(a.id, a.author, a.audience, a.roles, a.centre_id)
       and not exists (select 1 from public.announcement_reads r where r.announcement_id = a.id and r.profile_id = p_profile);
    if part is not null then body := body || E'NEW UPDATES\n' || part || E'\n\n'; end if;
  end if;

  if s.training_emails and p.volunteer_id is not null then
    select string_agg('  - ' || tt.name || case when ta.due_date is not null then ' - due ' || to_char(ta.due_date, 'DD Mon') else '' end, E'\n' order by tt.sort) into part
      from public.training_assignments ta join public.training_topics tt on tt.id = ta.topic_id
     where ta.volunteer_id = p.volunteer_id and ta.completed_on is null
       and (dow = 1 or ta.assigned_at >= (p_day - 1)::timestamp at time zone 'Asia/Kolkata');
    if part is not null then body := body || E'TRAININGS TO DO\n' || part || E'\n\n'; end if;
  end if;

  if s.cover_emails and p.volunteer_id is not null then
    select string_agg('  - ' || r.class_name || ' on ' || to_char(r.cover_date, 'DD Mon') || ', asked by ' || coalesce(r.requested_by_name, 'a teacher'), E'\n' order by r.cover_date) into part
      from public.class_cover_requests r
     where r.volunteer_id = p.volunteer_id and r.status = 'Waiting for teacher' and r.cover_date >= p_day;
    if part is not null then body := body || E'CAN YOU TAKE THESE CLASSES? PLEASE ACCEPT OR DECLINE\n' || part || E'\n\n'; end if;
  end if;

  if p.role = 'centre_lead' then
    select count(*) into n from public.class_cover_requests r join public.classes c on c.id = r.class_id
     where r.status = 'Waiting for centre lead' and c.centre_id = p.centre_id and r.cover_date >= p_day;
    if s.cover_emails and n > 0 then body := body || 'CLASS HAND-OVERS WAITING FOR YOUR APPROVAL: ' || n || E'\n\n'; end if;
    select count(*) into n from public.class_time_requests r join public.classes c on c.id = r.class_id
     where r.status = 'Pending' and c.centre_id = p.centre_id;
    if n > 0 then body := body || 'TIME-CHANGE REQUESTS WAITING FOR YOU: ' || n || E'\n\n'; end if;
    if s.checklist_reminders
       and p_day >= (date_trunc('month', p_day) + interval '1 month' - interval '3 days')::date
       and not exists (select 1 from public.monthly_checklists m where m.centre_id = p.centre_id and m.month = date_trunc('month', p_day)::date) then
      body := body || E'MONTHLY CHECKLIST\n  - This month''s checklist has not been filled in yet.\n\n';
    end if;
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  if body = '' then return null; end if;
  return 'Hello ' || coalesce(nullif(split_part(trim(p.full_name), ' ', 1), ''), 'there') || E',\n\n' || body
      || 'Open the portal: ' || s.portal_url || E'\n\n'
      || 'To stop these emails, sign in and choose "Email reminders" at the bottom of the menu.';
end $$;

revoke all on function app.build_digest(uuid, date), app.queue_cover_email(), app.apply_cover(public.class_cover_requests) from public, anon, authenticated;
revoke all on function public.request_cover(uuid, date, uuid, text), public.answer_cover(uuid, boolean, text),
  public.decide_cover(uuid, boolean, text), public.cancel_cover(uuid), public.cover_candidates(uuid) from public, anon;
grant execute on function public.request_cover(uuid, date, uuid, text), public.answer_cover(uuid, boolean, text),
  public.decide_cover(uuid, boolean, text), public.cancel_cover(uuid), public.cover_candidates(uuid) to authenticated;
grant execute on function app.my_name() to authenticated;
