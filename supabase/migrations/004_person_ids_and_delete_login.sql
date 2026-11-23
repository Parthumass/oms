-- =====================================================================
-- 004: one ID per person, and deleting a login made by mistake.
-- Run after 003. Safe to run more than once.
--
-- IDs:  PEF01BD  admin team and board      (BD)
--       PEF01L   centre leads              (L)
--       PEF01P   partner logins            (P)
--       PEF0001V volunteers                (V)  from the volunteer record
--       BPL0001S students                  (S)  centre code first
-- A login's ID also works as its login name.
-- =====================================================================

alter table public.profiles add column if not exists code text;
create unique index if not exists profiles_code_key on public.profiles (code);

create or replace function app.next_staff_code(p_suffix text) returns text
language plpgsql security definer set search_path = '' as $$
declare n integer; c text;
begin
  loop
    insert into app.counters (key, last) values ('PEF' || p_suffix, 1)
      on conflict (key) do update set last = app.counters.last + 1
      returning last into n;
    c := 'PEF' || lpad(n::text, 2, '0') || p_suffix;
    exit when not exists (select 1 from public.profiles where code = c);
  end loop;
  return c;
end $$;

create or replace function app.code_for(p_role public.app_role, p_volunteer uuid) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if p_role = 'volunteer' then
    return (select code from public.volunteers where id = p_volunteer);
  end if;
  return app.next_staff_code(case p_role when 'centre_lead' then 'L' when 'partner' then 'P' else 'BD' end);
end $$;

drop function if exists app.insert_login(text, text, text, public.app_role, uuid, uuid, uuid);
create or replace function app.insert_login(
  p_login text, p_password text, p_full_name text, p_role public.app_role,
  p_centre uuid, p_volunteer uuid, p_partner uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := gen_random_uuid();
  v_code text;
  v_email text;
begin
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'The password must be at least 8 characters.';
  end if;
  if p_role = 'centre_lead' and p_centre is null then raise exception 'Choose the centre for a centre lead.'; end if;
  if p_role = 'volunteer' and p_volunteer is null then raise exception 'Choose the volunteer record for a volunteer login.'; end if;
  if p_role = 'partner' and p_partner is null then raise exception 'Choose the partner for a partner login.'; end if;
  if p_volunteer is not null and exists (select 1 from public.profiles where volunteer_id = p_volunteer) then
    raise exception 'That volunteer already has a login.';
  end if;

  v_code := app.code_for(p_role, p_volunteer);
  -- no login name given: the ID is the login name
  v_email := app.login_email(coalesce(nullif(trim(p_login), ''), v_code));
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'That login name is already taken.';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', v_email,
          extensions.crypt(p_password, extensions.gen_salt('bf', 10)), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('full_name', p_full_name), now(), now(), '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text, 'email',
          jsonb_build_object('sub', uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
          now(), now());

  update public.profiles
     set full_name = nullif(trim(p_full_name), ''), role = p_role, code = v_code,
         centre_id = case when p_role = 'centre_lead' then p_centre end,
         volunteer_id = p_volunteer,
         partner_id = case when p_role = 'partner' then p_partner end
   where id = uid;
  return jsonb_build_object('id', uid, 'code', v_code, 'login', split_part(v_email, '@portal.pratyagra.org', 1));
end $$;

drop function if exists public.create_login(text, text, text, public.app_role, uuid, uuid, uuid);
create or replace function public.create_login(
  p_login text, p_password text, p_full_name text, p_role public.app_role,
  p_centre uuid default null, p_volunteer uuid default null, p_partner uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not app.can_manage_login(p_role, p_volunteer) then
    raise exception 'You are not allowed to create that kind of login.';
  end if;
  return app.insert_login(p_login, p_password, p_full_name, p_role, p_centre, p_volunteer, p_partner);
end $$;

create or replace function app.create_first_admin(p_login text, p_password text, p_full_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  if (select auth.uid()) is not null then
    raise exception 'Run this from the Supabase SQL Editor.';
  end if;
  r := app.insert_login(p_login, p_password, p_full_name, 'admin', null, null, null);
  return 'Admin login created: ' || (r ->> 'login') || ' (ID ' || (r ->> 'code') || ')';
end $$;

-- Remove a login made by mistake. Admin only, and never your own.
-- Records that person entered (attendance, marks) stay.
create or replace function public.delete_login(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_admin() then
    raise exception 'Only an admin can delete a login.';
  end if;
  if p_user = (select auth.uid()) then
    raise exception 'You cannot delete your own login.';
  end if;
  delete from auth.users where id = p_user;
end $$;

revoke all on function app.insert_login(text, text, text, public.app_role, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function app.create_first_admin(text, text, text) from public, anon, authenticated;
revoke all on function app.next_staff_code(text) from public, anon, authenticated;
revoke all on function app.code_for(public.app_role, uuid) from public, anon, authenticated;
revoke all on function public.create_login(text, text, text, public.app_role, uuid, uuid, uuid) from public, anon;
revoke all on function public.delete_login(uuid) from public, anon;
grant execute on function public.create_login(text, text, text, public.app_role, uuid, uuid, uuid) to authenticated;
grant execute on function public.delete_login(uuid) to authenticated;

-- IDs for logins that already exist. Volunteers take their volunteer code.
update public.profiles p set code = v.code
  from public.volunteers v
 where p.code is null and p.role = 'volunteer' and v.id = p.volunteer_id;
