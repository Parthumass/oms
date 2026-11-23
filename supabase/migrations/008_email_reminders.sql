-- =====================================================================
-- 008: email reminders. Run after 007. Safe to run more than once.
--
-- The database decides who is due an email and writes it to an outbox.
-- A small Google Apps Script (email/apps-script.gs), running under the
-- Gmail account that should send the mail, asks for the outbox once an
-- hour and sends it. Nothing is sent until an admin switches it on in
-- Setup > Email.
--
-- Each person gets at most one daily summary: today's classes, attendance
-- not marked, tasks, unread updates, trainings, and for centre leads the
-- monthly checklist and waiting time-change requests. Task emails (new
-- task, changes asked for, handed in) go out with the next hourly run.
-- =====================================================================

alter table public.profiles add column if not exists contact_email text;
alter table public.profiles add column if not exists email_off boolean not null default false;

create table if not exists public.mail_settings (
  id                  boolean primary key default true check (id),
  enabled             boolean not null default false,
  send_hour_ist       integer not null default 7 check (send_hour_ist between 0 and 23),
  class_reminders     boolean not null default true,
  attendance_nudges   boolean not null default true,
  task_emails         boolean not null default true,
  update_emails       boolean not null default true,
  training_emails     boolean not null default true,
  checklist_reminders boolean not null default true,
  daily_cap           integer not null default 90 check (daily_cap between 1 and 2000),
  portal_url          text not null default 'https://pratyagra-portal.pages.dev',
  last_digest_date    date,
  last_run            timestamptz
);
insert into public.mail_settings (id) values (true) on conflict (id) do nothing;
alter table public.mail_settings enable row level security;
drop policy if exists read on public.mail_settings;
create policy read on public.mail_settings for select to authenticated using ((select app.is_staff()));
drop policy if exists upd on public.mail_settings;
create policy upd on public.mail_settings for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- The shared secret the sending script must present. Not reachable through the API.
create table if not exists app.mail_secret (
  id     boolean primary key default true check (id),
  secret text not null default encode(extensions.gen_random_bytes(24), 'hex')
);
insert into app.mail_secret (id) values (true) on conflict (id) do nothing;
alter table app.mail_secret enable row level security;
revoke all on app.mail_secret from public, anon, authenticated;

create table if not exists public.email_outbox (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles on delete cascade,
  to_email   text not null,
  subject    text not null,
  body       text not null,
  kind       text not null,
  for_date   date,
  status     text not null default 'pending' check (status in ('pending','sending','sent')),
  created_at timestamptz not null default now(),
  picked_at  timestamptz,
  sent_at    timestamptz
);
create unique index if not exists email_outbox_digest_once on public.email_outbox (profile_id, for_date) where kind = 'digest';
create index if not exists email_outbox_status_idx on public.email_outbox (status);
alter table public.email_outbox enable row level security;
drop policy if exists read on public.email_outbox;
create policy read on public.email_outbox for select to authenticated using ((select app.is_staff()));

revoke all on public.mail_settings, public.email_outbox from anon;
grant select, update on public.mail_settings to authenticated;
grant select on public.email_outbox to authenticated;

-- Where to write to this person, or null if they have no usable address or opted out.
create or replace function app.mail_address(p_profile uuid) returns text
language sql stable security definer set search_path = '' as $$
  select nullif(trim(coalesce(nullif(trim(p.contact_email), ''), nullif(trim(v.email), ''),
                              case when p.email not like '%@portal.pratyagra.org' then p.email end)), '')
  from public.profiles p left join public.volunteers v on v.id = p.volunteer_id
  where p.id = p_profile and p.active and p.role is not null and not p.email_off
$$;

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
     where c.volunteer_id = p.volunteer_id and c.active and dow = any (c.weekdays)
       and p_day >= c.start_date and (c.end_date is null or p_day <= c.end_date);
    if part is not null then body := body || E'YOUR CLASSES TODAY\n' || part || E'\n\n'; end if;
  end if;

  if s.attendance_nudges and p.volunteer_id is not null then
    select string_agg('  - ' || c.name, E'\n' order by c.name) into part
      from public.classes c
     where c.volunteer_id = p.volunteer_id and c.active and ydow = any (c.weekdays)
       and p_day - 1 >= c.start_date and (c.end_date is null or p_day - 1 <= c.end_date)
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

  if p.role = 'centre_lead' then
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

-- Called by the sending script. Builds today's summaries once the hour has
-- come, then hands over what is waiting (never more than the daily cap).
create or replace function public.mail_run(p_secret text)
returns table (id uuid, to_email text, subject text, body text)
language plpgsql security definer set search_path = '' as $$
declare
  s public.mail_settings;
  ist timestamp := now() at time zone 'Asia/Kolkata';
  today date := (now() at time zone 'Asia/Kolkata')::date;
  r record;
  txt text;
  room integer;
begin
  if p_secret is null or p_secret <> (select m.secret from app.mail_secret m) then
    raise exception 'Not allowed.';
  end if;
  select * into s from public.mail_settings;
  update public.mail_settings set last_run = now();
  if not s.enabled then return; end if;

  if extract(hour from ist) >= s.send_hour_ist and s.last_digest_date is distinct from today then
    for r in select p.id, app.mail_address(p.id) as addr from public.profiles p loop
      continue when r.addr is null;
      txt := app.build_digest(r.id, today);
      continue when txt is null;
      insert into public.email_outbox (profile_id, to_email, subject, body, kind, for_date)
      values (r.id, r.addr, 'Pratyagra: your day, ' || to_char(today, 'DD Mon'), txt, 'digest', today)
      on conflict do nothing;
    end loop;
    update public.mail_settings set last_digest_date = today;
  end if;

  select s.daily_cap - count(*) into room from public.email_outbox o
   where o.status in ('sending', 'sent') and (o.picked_at at time zone 'Asia/Kolkata')::date = today;
  return query
    update public.email_outbox o set status = 'sending', picked_at = now()
     where o.id in (select x.id from public.email_outbox x
                    where x.status = 'pending' or (x.status = 'sending' and x.picked_at < now() - interval '2 hours')
                    order by x.created_at limit greatest(0, least(40, room)))
    returning o.id, o.to_email, o.subject, o.body;
end $$;

-- The script reports which emails Gmail accepted.
create or replace function public.mail_done(p_secret text, p_ids uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_secret is null or p_secret <> (select m.secret from app.mail_secret m) then
    raise exception 'Not allowed.';
  end if;
  update public.email_outbox set status = 'sent', sent_at = now() where id = any (p_ids) and status = 'sending';
  get diagnostics n = row_count;
  return n;
end $$;

-- Task emails: new task, changes asked for, handed in.
create or replace function app.queue_task_email() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s public.mail_settings;
  who uuid;
  subj text;
  addr text;
begin
  select * into s from public.mail_settings;
  if not (s.enabled and s.task_emails) then return new; end if;
  if tg_op = 'INSERT' then
    who := new.assignee; subj := 'New task: ' || new.title;
  elsif new.status is distinct from old.status and new.status = 'Changes needed' then
    who := new.assignee; subj := 'Changes asked for: ' || new.title;
  elsif new.status is distinct from old.status and new.status = 'Submitted' then
    who := new.assigned_by; subj := 'Handed in for review: ' || new.title;
  else
    return new;
  end if;
  addr := app.mail_address(who);
  if addr is null then return new; end if;
  insert into public.email_outbox (profile_id, to_email, subject, body, kind)
  values (who, addr, 'Pratyagra: ' || subj,
          subj || E'\n\n'
          || case when tg_op = 'INSERT' then 'From: ' || coalesce(new.assigned_by_name, 'Pratyagra') || E'\n' else 'For: ' || coalesce(new.assignee_name, '') || E'\n' end
          || case when new.due_date is not null then 'Due: ' || to_char(new.due_date, 'DD Mon YYYY') || E'\n' else '' end
          || case when new.status = 'Changes needed' and new.feedback is not null then E'\n' || new.feedback || E'\n' else '' end
          || case when tg_op = 'INSERT' and new.details is not null then E'\n' || new.details || E'\n' else '' end
          || E'\nOpen it under Tasks: ' || s.portal_url || '/tasks', 'task');
  return new;
end $$;
drop trigger if exists tasks_email on public.tasks;
create trigger tasks_email after insert or update on public.tasks
  for each row execute function app.queue_task_email();

-- Each person can set where their reminders go, or switch them off.
create or replace function public.set_my_mail_prefs(p_email text, p_off boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  if (select auth.uid()) is null then raise exception 'Sign in first.'; end if;
  if v is not null and v !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
    raise exception 'That email address does not look right.';
  end if;
  update public.profiles set contact_email = v, email_off = coalesce(p_off, false) where id = (select auth.uid());
end $$;

revoke all on function app.build_digest(uuid, date), app.queue_task_email() from public, anon, authenticated;
revoke all on function public.set_my_mail_prefs(text, boolean) from public, anon;
grant execute on function public.set_my_mail_prefs(text, boolean) to authenticated;
grant execute on function app.mail_address(uuid) to authenticated;
-- the sending script signs in with the public key only, so these two are open; the secret is the lock
grant execute on function public.mail_run(text), public.mail_done(text, uuid[]) to anon, authenticated;
