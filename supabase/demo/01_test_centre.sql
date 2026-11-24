-- =====================================================================
-- Test data for demos: one test centre with a class, a teacher record,
-- five students and a partner. Nothing here touches real records.
-- Everything is under centre code TEST, so IDs come out as TEST0001S,
-- TEST0001V and real ID numbers are not used up. Safe to run again.
-- =====================================================================
do $$
declare
  c uuid; p uuid; pr uuid; v uuid; k uuid; i int;
begin
  select id into c from public.centres where code = 'TEST';
  if c is null then
    insert into public.centres (code, name, city) values ('TEST', 'Test Centre (demo)', 'Demo') returning id into c;
  end if;

  select id into p from public.programs where name = 'Test Program (demo)';
  if p is null then
    insert into public.programs (name) values ('Test Program (demo)') returning id into p;
  end if;

  select id into pr from public.partners where name = 'Test Partner (demo)';
  if pr is null then
    insert into public.partners (name) values ('Test Partner (demo)') returning id into pr;
    insert into public.partner_scopes (partner_id, centre_id) values (pr, c);
  end if;

  select id into v from public.volunteers where centre_id = c and full_name = 'Admin Teacher';
  if v is null then
    insert into public.volunteers (full_name, centre_id, verified, volunteer_type, notes)
    values ('Admin Teacher', c, true, 'Test', 'Test record for demos. Not a real person.') returning id into v;
  end if;

  select id into k from public.classes where centre_id = c and name = 'Test Class';
  if k is null then
    insert into public.classes (centre_id, program_id, name, subject, class_type, mode, volunteer_id, weekdays, start_time, duration_min)
    values (c, p, 'Test Class', 'Maths', 'Afternoon', 'Online', v, '{1,2,3,4,5}', '16:00', 60) returning id into k;
  end if;

  if not exists (select 1 from public.students where centre_id = c) then
    for i in 1..5 loop
      with s as (
        insert into public.students (full_name, centre_id, standard, verified)
        values ('Test Student ' || i, c, '5', true) returning id
      )
      insert into public.class_students (class_id, student_id) select k, id from s;
    end loop;
  end if;
end $$;

select 'centre' as what, code, name from public.centres where code = 'TEST'
union all select 'teacher record', v.code, v.full_name from public.volunteers v join public.centres c on c.id = v.centre_id where c.code = 'TEST'
union all select 'student', s.code, s.full_name from public.students s join public.centres c on c.id = s.centre_id where c.code = 'TEST'
order by 1, 2;
