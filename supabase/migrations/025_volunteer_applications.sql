-- =====================================================================
-- 025: public volunteer sign-up form. Run after 024. Safe to re-run.
--
-- Anyone can fill in the form at <portal>/join without a login. What they
-- send lands in volunteer_applications. Nothing else is created: no
-- volunteer record and never a login.
--
-- The admin team and board see new applications on the Volunteers page.
-- "Add as volunteer" creates the volunteer record (with a code) from the
-- application; a login is then issued in the usual way by the admin team,
-- board or centre lead. "Not now" closes the application.
--
-- The form can only add an application, through submit_volunteer_application.
-- It cannot read anything. It limits how much one email address, and how
-- much the form as a whole, can send, and quietly drops obvious bots.
-- =====================================================================

create table if not exists public.volunteer_applications (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null,
  email           text not null,
  phone           text not null,
  gender          text check (gender in ('Male', 'Female', 'Other')),
  location        text,              -- city / state
  education       text,
  occupation      text,
  company         text,              -- company, college or school
  volunteer_type  text,              -- how they would like to help
  subject_pref    text,
  class_pref      text,
  languages       text,
  availability    text,              -- days and times that suit them
  hours_per_week  text,
  heard_from      text,
  motivation      text,
  consent         boolean not null default false,
  status          text not null default 'New' check (status in ('New', 'Added', 'Not now')),
  volunteer_id    uuid references public.volunteers on delete set null,
  reviewed_by_name text,
  review_note     text,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists volunteer_applications_email on public.volunteer_applications (lower(email), created_at);
alter table public.volunteer_applications enable row level security;

drop policy if exists read on public.volunteer_applications;
create policy read on public.volunteer_applications for select to authenticated using ((select app.is_staff()));
revoke all on public.volunteer_applications from anon;
revoke insert, update, delete on public.volunteer_applications from authenticated;
grant select on public.volunteer_applications to authenticated;

create or replace function public.submit_volunteer_application(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  f jsonb := coalesce(p, '{}'::jsonb);
  t text;
  nm text := left(trim(coalesce(f ->> 'full_name', '')), 120);
  em text := lower(left(trim(coalesce(f ->> 'email', '')), 200));
  ph text := left(trim(coalesce(f ->> 'phone', '')), 30);
begin
  -- a hidden field people never see: bots fill it in. Pretend all is well.
  if coalesce(trim(f ->> 'website'), '') <> '' then return 'ok'; end if;
  if length(nm) < 2 then raise exception 'Please enter your full name.'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Please enter a valid email address.'; end if;
  if regexp_replace(ph, '[^0-9]', '', 'g') !~ '^[0-9]{7,15}$' then raise exception 'Please enter a valid phone number.'; end if;
  if coalesce((f ->> 'consent')::boolean, false) is not true then raise exception 'Please tick the box to agree before sending.'; end if;
  t := f ->> 'gender';
  if t is not null and t <> '' and t not in ('Male', 'Female', 'Other') then raise exception 'Please choose a gender from the list.'; end if;

  if (select count(*) from public.volunteer_applications a where lower(a.email) = em and a.created_at > now() - interval '1 day') >= 2 then
    raise exception 'We already have your form. Thank you! We will be in touch soon.';
  end if;
  if (select count(*) from public.volunteer_applications a where a.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Too many forms are coming in right now. Please try again in an hour.';
  end if;

  insert into public.volunteer_applications (full_name, email, phone, gender, location, education, occupation, company,
         volunteer_type, subject_pref, class_pref, languages, availability, hours_per_week, heard_from, motivation, consent)
  values (nm, em, ph, nullif(t, ''),
          nullif(left(trim(f ->> 'location'), 200), ''), nullif(left(trim(f ->> 'education'), 200), ''),
          nullif(left(trim(f ->> 'occupation'), 200), ''), nullif(left(trim(f ->> 'company'), 200), ''),
          nullif(left(trim(f ->> 'volunteer_type'), 200), ''), nullif(left(trim(f ->> 'subject_pref'), 200), ''),
          nullif(left(trim(f ->> 'class_pref'), 200), ''), nullif(left(trim(f ->> 'languages'), 200), ''),
          nullif(left(trim(f ->> 'availability'), 500), ''), nullif(left(trim(f ->> 'hours_per_week'), 50), ''),
          nullif(left(trim(f ->> 'heard_from'), 200), ''), nullif(left(trim(f ->> 'motivation'), 2000), ''), true);
  return 'ok';
end $$;
revoke all on function public.submit_volunteer_application(jsonb) from public;
grant execute on function public.submit_volunteer_application(jsonb) to anon, authenticated;

-- Admin team / board: make the application a volunteer record.
create or replace function public.add_volunteer_from_application(p_id uuid, p_centre uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a public.volunteer_applications; vid uuid; dup text; who text;
begin
  if not app.is_staff() then raise exception 'Only the admin team or the board can do this.'; end if;
  select * into a from public.volunteer_applications where id = p_id for update;
  if not found or a.status <> 'New' then raise exception 'This application has already been dealt with.'; end if;
  select coalesce(v.code, v.full_name) into dup from public.volunteers v where lower(v.email) = lower(a.email) limit 1;
  if dup is not null then raise exception 'A volunteer with this email is already in the portal (%). Use "Not now" if it is the same person.', dup; end if;
  insert into public.volunteers (full_name, email, phone, centre_id, status, verified, gender, education, occupation, company,
                                 volunteer_type, subject_pref, class_pref, location, notes)
  values (a.full_name, a.email, a.phone, p_centre, 'Active', false, a.gender, a.education, a.occupation, a.company,
          a.volunteer_type, a.subject_pref, a.class_pref, a.location,
          nullif(concat_ws(E'\n',
            case when a.languages is not null then 'Languages: ' || a.languages end,
            case when a.availability is not null then 'Available: ' || a.availability end,
            case when a.hours_per_week is not null then 'Hours a week: ' || a.hours_per_week end,
            case when a.heard_from is not null then 'Heard about us: ' || a.heard_from end,
            case when a.motivation is not null then 'Why: ' || a.motivation end,
            'From the sign-up form, ' || to_char(a.created_at at time zone 'Asia/Kolkata', 'DD Mon YYYY')), ''))
  returning id into vid;
  select coalesce(nullif(trim(full_name), ''), email) into who from public.profiles where id = (select auth.uid());
  update public.volunteer_applications set status = 'Added', volunteer_id = vid, reviewed_by_name = who, reviewed_at = now() where id = p_id;
  return vid;
end $$;

create or replace function public.close_volunteer_application(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare who text;
begin
  if not app.is_staff() then raise exception 'Only the admin team or the board can do this.'; end if;
  select coalesce(nullif(trim(full_name), ''), email) into who from public.profiles where id = (select auth.uid());
  update public.volunteer_applications
     set status = 'Not now', review_note = nullif(trim(p_note), ''), reviewed_by_name = who, reviewed_at = now()
   where id = p_id and status = 'New';
  if not found then raise exception 'This application has already been dealt with.'; end if;
end $$;

revoke all on function public.add_volunteer_from_application(uuid, uuid), public.close_volunteer_application(uuid, text) from public, anon;
grant execute on function public.add_volunteer_from_application(uuid, uuid), public.close_volunteer_application(uuid, text) to authenticated;
