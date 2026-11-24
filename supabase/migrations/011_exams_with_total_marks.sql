-- =====================================================================
-- 011: exams with a total. The centre lead (or the admin team) creates
-- an exam for a class, for example "Unit Test 1" out of 20. The class
-- teacher then enters the marks each student got out of that total.
-- The percentage is worked out from the two and kept for the reports.
-- Run after 010. Safe to re-run.
-- =====================================================================

alter type public.exam_type add value if not exists 'Unit Test';
alter type public.exam_type add value if not exists 'Term Exam';
alter type public.exam_type add value if not exists 'Other';

alter table public.assessments add column if not exists name text;
alter table public.assessments add column if not exists max_marks numeric(7,2) not null default 100
  check (max_marks > 0 and max_marks <= 1000);
update public.assessments set name = exam_type::text where name is null;

alter table public.assessment_scores add column if not exists marks numeric(7,2);
update public.assessment_scores sc set marks = round(sc.pct * a.max_marks / 100, 2)
  from public.assessments a where a.id = sc.assessment_id and sc.marks is null;

-- Marks entered -> check against the total and work out the percentage.
create or replace function app.score_from_marks() returns trigger
language plpgsql security definer set search_path = '' as $$
declare mx numeric;
begin
  select max_marks into mx from public.assessments where id = new.assessment_id;
  if new.marks is null and new.pct is not null then          -- older screens send a percentage
    new.marks := round(new.pct * mx / 100, 2);
  end if;
  if new.marks is null then raise exception 'Enter the marks.'; end if;
  if new.marks < 0 or new.marks > mx then
    raise exception 'Marks must be between 0 and %.', trim(trailing '.' from trim(trailing '0' from mx::text));
  end if;
  new.pct := round(new.marks / mx * 100, 2);
  return new;
end $$;
drop trigger if exists assessment_scores_marks on public.assessment_scores;
create trigger assessment_scores_marks before insert or update on public.assessment_scores
  for each row execute function app.score_from_marks();

-- Total changed -> percentages follow. Refused if marks already entered would not fit.
create or replace function app.rescale_scores() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.max_marks is distinct from old.max_marks then
    if exists (select 1 from public.assessment_scores where assessment_id = new.id and marks > new.max_marks) then
      raise exception 'Some marks already entered are higher than the new total.';
    end if;
    update public.assessment_scores set pct = round(marks / new.max_marks * 100, 2) where assessment_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists assessments_rescale on public.assessments;
create trigger assessments_rescale after update on public.assessments
  for each row execute function app.rescale_scores();

-- Only the admin team, board and the centre lead set up or change an exam.
-- The class teacher still enters marks (assessment_scores rules are unchanged).
drop policy if exists manage on public.assessments;
create policy manage on public.assessments for all to authenticated
  using      ((select app.is_staff()) or app.is_lead_of(app.class_centre(class_id)))
  with check ((select app.is_staff()) or app.is_lead_of(app.class_centre(class_id)));

revoke all on function app.score_from_marks() from public, anon, authenticated;
revoke all on function app.rescale_scores() from public, anon, authenticated;
