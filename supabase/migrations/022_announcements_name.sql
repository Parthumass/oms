-- =====================================================================
-- 022: "Updates" are now called "Announcements". The daily summary email
-- says NEW ANNOUNCEMENTS instead of NEW UPDATES. Run after 021. Safe to re-run.
-- =====================================================================
do $$
declare d text;
begin
  d := pg_get_functiondef('app.build_digest(uuid, date)'::regprocedure);
  if position('NEW UPDATES' in d) > 0 then
    execute replace(d, 'NEW UPDATES', 'NEW ANNOUNCEMENTS');
  end if;
end $$;
