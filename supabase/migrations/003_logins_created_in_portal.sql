-- =====================================================================
-- 003: logins are created inside the portal (see functions/manage-login)
-- Run after 002. Safe to run more than once.
-- =====================================================================

-- The manage-login function works with the service key. It needs to read the
-- caller's and the target's profile, set the new login's role, and read a
-- volunteer's home centre. It is given nothing else.
grant usage on schema public to service_role;
grant select, update on public.profiles to service_role;
grant select on public.volunteers to service_role;
