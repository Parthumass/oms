-- =====================================================================
-- Five test logins, one per role, for demos and testing.
-- Run 01_test_centre.sql first.
--
--   1. On the line marked below, replace TYPE-A-PASSWORD-HERE with a
--      password of your choice (8 characters or more). All five test
--      logins get this password; each can change it after signing in.
--   2. Click Run.
--
--   Login name      Role           Sees
--   admin-test      Admin          everything (real data too)
--   admin-board     Board          everything (real data too)
--   admin-lead      Centre lead    the Test Centre only
--   admin-teacher   Volunteer      the Test Class only
--   admin-partner   Partner        Test Centre attendance and marks, read-only
--
-- IDs are TEST01BD, TEST02BD, TEST01L, TEST01P and the teacher's
-- TEST0001V, so no real PEF ID numbers are used up.
-- =====================================================================
do $$
declare
  pw text := 'TYPE-A-PASSWORD-HERE';          -- <<< replace this, keep the quotes
  c uuid; v uuid; pr uuid; r jsonb;
  bd int; l int; p int;
begin
  if pw = 'TYPE-A-PASSWORD-HERE' then
    raise exception 'Replace TYPE-A-PASSWORD-HERE with a password of your choice first.';
  end if;
  select id into c from public.centres where code = 'TEST';
  if c is null then raise exception 'Run 01_test_centre.sql first.'; end if;
  select id into v from public.volunteers where centre_id = c and full_name = 'Admin Teacher';
  select id into pr from public.partners where name = 'Test Partner (demo)';
  if exists (select 1 from public.profiles where code like 'TEST%') then
    raise exception 'The test logins already exist. Use Logins in the portal to reset a password.';
  end if;

  -- remember where the real ID numbering stands, to put it back after
  select last into bd from app.counters where key = 'PEFBD';
  select last into l  from app.counters where key = 'PEFL';
  select last into p  from app.counters where key = 'PEFP';

  r := app.insert_login('admin-test', pw, 'Admin Test', 'admin', null, null, null);
  update public.profiles set code = 'TEST01BD', title = 'Test Admin' where id = (r ->> 'id')::uuid;

  r := app.insert_login('admin-board', pw, 'Admin Board', 'board', null, null, null);
  update public.profiles set code = 'TEST02BD', title = 'Test Board' where id = (r ->> 'id')::uuid;

  r := app.insert_login('admin-lead', pw, 'Admin Program Lead', 'centre_lead', c, null, null);
  update public.profiles set code = 'TEST01L', title = 'Test Centre Lead' where id = (r ->> 'id')::uuid;

  r := app.insert_login('admin-teacher', pw, 'Admin Teacher', 'volunteer', null, v, null);
  update public.profiles set title = 'Test Teacher' where id = (r ->> 'id')::uuid;

  r := app.insert_login('admin-partner', pw, 'Admin Partner', 'partner', null, null, pr);
  update public.profiles set code = 'TEST01P', title = 'Test Partner' where id = (r ->> 'id')::uuid;

  -- put the real ID numbering back
  if bd is null then delete from app.counters where key = 'PEFBD'; else update app.counters set last = bd where key = 'PEFBD'; end if;
  if l  is null then delete from app.counters where key = 'PEFL';  else update app.counters set last = l  where key = 'PEFL';  end if;
  if p  is null then delete from app.counters where key = 'PEFP';  else update app.counters set last = p  where key = 'PEFP';  end if;
end $$;

select split_part(email, '@', 1) as login_name, code as id, full_name, role, title
  from public.profiles where code like 'TEST%' order by code;
