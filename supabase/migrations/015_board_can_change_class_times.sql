-- =====================================================================
-- 015: the board can do everything a centre lead can. The one gap was
-- class times: changing a class's days or start time, and deciding a
-- teacher's request to change them. Now the admin team, the board and
-- that centre's lead can. Run after 014. Safe to re-run.
-- =====================================================================

create or replace function app.guard_class_time() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.start_time is distinct from old.start_time or new.weekdays is distinct from old.weekdays)
     and (select auth.uid()) is not null
     and not (app.is_staff() or app.is_lead_of(old.centre_id)) then
    raise exception 'Only the centre lead can change a class time.';
  end if;
  return new;
end $$;

create or replace function public.decide_time_request(p_request uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.class_time_requests;
begin
  select * into r from public.class_time_requests where id = p_request and status = 'Pending';
  if not found then raise exception 'That request is no longer waiting.'; end if;
  if not (app.is_staff() or app.is_lead_of(app.class_centre(r.class_id))) then
    raise exception 'Only the centre lead can decide this.';
  end if;
  if p_approve then
    update public.classes set weekdays = r.new_weekdays, start_time = r.new_start_time where id = r.class_id;
  end if;
  update public.class_time_requests
     set status = case when p_approve then 'Approved' else 'Declined' end,
         decision_note = nullif(trim(p_note), ''), decided_at = now(),
         decided_by_name = (select coalesce(full_name, email) from public.profiles where id = (select auth.uid()))
   where id = p_request;
end $$;
