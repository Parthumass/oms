-- =====================================================================
-- 009: a job title on a login (COO, CEO, Programme Lead...). Shown in
-- place of the role name. It is a label only: what a person can do still
-- comes from their role. Run after 008. Safe to run more than once.
-- =====================================================================
alter table public.profiles add column if not exists title text;
