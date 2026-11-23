-- =====================================================================
-- 003: logins are created by the admin team, board or a centre lead.
-- Nobody signs themselves up. Run after 002. Safe to run more than once.
--
-- A login is a login name plus a password chosen by whoever creates it.
-- Login names are stored as <name>@portal.pratyagra.org, an address that
-- receives no mail; a full email address can be used instead.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- New logins no longer take a role from the old "approved emails" list.
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(new.email), nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists invites_apply on public.invites;
delete from public.invites;

create or replace function app.login_email(p_login text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := lower(trim(coalesce(p_login, '')));
begin
  if position('@' in v) > 0 then
    if v !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
      raise exception 'That email address does not look right.';
    end if;
    return v;
  end if;
  if v !~ '^[a-z0-9][a-z0-9._-]{2,39}$' then
    raise exception 'Login name must be 3 to 40 characters: letters, numbers, dot, dash or underscore.';
  end if;
  return v || '@portal.pratyagra.org';
end $$;

-- May the signed-in person manage a login with this role and volunteer link?
--   admin        any login
--   board        any login except an admin
--   centre lead  volunteer logins for volunteers of their own centre
create or replace function app.can_manage_login(p_role public.app_role, p_volunteer uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case app.my_role()
    when 'admin' then true
    when 'board' then p_role is distinct from 'admin'
    when 'centre_lead' then coalesce(p_role = 'volunteer' and app.is_lead_of(app.volunteer_centre(p_volunteer)), false)
    else false
  end
$$;

create or replace function app.insert_login(
  p_email text, p_password text, p_full_name text, p_role public.app_role,
  p_centre uuid, p_volunteer uuid, p_partner uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := gen_random_uuid();
begin
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'The password must be at least 8 characters.';
  end if;
  if exists (select 1 from auth.users where email = p_email) then
    raise exception 'That login name is already taken.';
  end if;
  if p_role = 'centre_lead' and p_centre is null then raise exception 'Choose the centre for a centre lead.'; end if;
  if p_role = 'volunteer' and p_volunteer is null then raise exception 'Choose the volunteer record for a volunteer login.'; end if;
  if p_role = 'partner' and p_partner is null then raise exception 'Choose the partner for a partner login.'; end if;
  if p_volunteer is not null and exists (select 1 from public.profiles where volunteer_id = p_volunteer) then
    raise exception 'That volunteer already has a login.';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', p_email,
          extensions.crypt(p_password, extensions.gen_salt('bf', 10)), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('full_name', p_full_name), now(), now(), '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text, 'email',
          jsonb_build_object('sub', uid::text, 'email', p_email, 'email_verified', true, 'phone_verified', false),
          now(), now());

  -- the profile row was just created by the sign-up trigger; give it its role
  update public.profiles
     set full_name = nullif(trim(p_full_name), ''), role = p_role,
         centre_id = case when p_role = 'centre_lead' then p_centre end,
         volunteer_id = p_volunteer,
         partner_id = case when p_role = 'partner' then p_partner end
   where id = uid;
  return uid;
end $$;

-- Called from the portal.
create or replace function public.create_login(
  p_login text, p_password text, p_full_name text, p_role public.app_role,
  p_centre uuid default null, p_volunteer uuid default null, p_partner uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if not app.can_manage_login(p_role, p_volunteer) then
    raise exception 'You are not allowed to create that kind of login.';
  end if;
  return app.insert_login(app.login_email(p_login), p_password, p_full_name, p_role, p_centre, p_volunteer, p_partner);
end $$;

-- Called from the portal: set a new password for someone who forgot theirs.
create or replace function public.reset_login_password(p_user uuid, p_password text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.profiles;
begin
  select * into t from public.profiles where id = p_user;
  if not found or t.role is null or not app.can_manage_login(t.role, t.volunteer_id) then
    raise exception 'You are not allowed to reset that password.';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'The password must be at least 8 characters.';
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)), updated_at = now()
   where id = p_user;
end $$;

-- For the SQL Editor only: creates the very first admin login.
--   select app.create_first_admin('login-name', 'a-password-you-choose', 'Full Name');
create or replace function app.create_first_admin(p_login text, p_password text, p_full_name text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null then
    raise exception 'Run this from the Supabase SQL Editor.';
  end if;
  perform app.insert_login(app.login_email(p_login), p_password, p_full_name, 'admin', null, null, null);
  return 'Admin login created: ' || lower(trim(p_login));
end $$;

revoke all on function app.insert_login(text, text, text, public.app_role, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function app.create_first_admin(text, text, text) from public, anon, authenticated;
revoke all on function public.create_login(text, text, text, public.app_role, uuid, uuid, uuid) from public, anon;
revoke all on function public.reset_login_password(uuid, text) from public, anon;
grant execute on function public.create_login(text, text, text, public.app_role, uuid, uuid, uuid) to authenticated;
grant execute on function public.reset_login_password(uuid, text) to authenticated;
grant execute on function app.login_email(text) to authenticated;
grant execute on function app.can_manage_login(public.app_role, uuid) to authenticated;
