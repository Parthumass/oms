-- =====================================================================
-- 023: students who join a class part-way through.
-- Run after 022. Safe to re-run.
--
-- Each student in a class now has a "joined on" date. Class days before
-- that date are not theirs: they cannot be marked, show as a dash in the
-- register, and never count in attendance percentages, the student's
-- or the class's. Empty means "in the class from the start".
--
-- A student added to a class that has already met gets today's date
-- (India time). A centre lead or the admin team can change it on the
-- attendance page, for example to fill in past attendance for a student
-- who was in the class before being added to the portal.
-- Students already in classes are left as "from the start".
-- =====================================================================

alter table public.class_students add column if not exists joined_on date;

create or replace function app.class_students_joined() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.joined_on is null and exists (
       select 1 from public.sessions s
        where s.class_id = new.class_id
          and s.session_date < (now() at time zone 'Asia/Kolkata')::date) then
    new.joined_on := (now() at time zone 'Asia/Kolkata')::date;
  end if;
  return new;
end $$;
drop trigger if exists class_students_joined on public.class_students;
create trigger class_students_joined before insert on public.class_students
  for each row execute function app.class_students_joined();
revoke all on function app.class_students_joined() from public, anon, authenticated;

-- A mark can only be saved for a student who was in the class that day.
create or replace function app.session_has_student(ses uuid, stu uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sessions s
                 join public.class_students cs on cs.class_id = s.class_id
                 where s.id = ses and cs.student_id = stu
                   and (cs.joined_on is null or s.session_date >= cs.joined_on))
$$;

-- Percentages leave out any day before the student joined.
create or replace view public.attendance_summary with (security_invoker = true) as
select s.class_id,
       a.student_id,
       count(*)                                   as marked,
       count(*) filter (where a.status = 'X')     as present,
       round(100.0 * count(*) filter (where a.status = 'X') / count(*), 1) as pct
from public.attendance a
join public.sessions s on s.id = a.session_id
left join public.class_students cs on cs.class_id = s.class_id and cs.student_id = a.student_id
where cs.joined_on is null or s.session_date >= cs.joined_on
group by s.class_id, a.student_id;
