do $$ begin if not exists (select 1 from pg_roles where rolname=$r$anon$r$) then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; end if; end $$;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
grant usage on schema public to authenticated, anon;
-- extras needed by migration 003 (staff-created logins)
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
alter table auth.users add column instance_id uuid, add column aud text, add column role text, add column encrypted_password text,
  add column email_confirmed_at timestamptz, add column raw_app_meta_data jsonb, add column created_at timestamptz, add column updated_at timestamptz,
  add column confirmation_token text, add column recovery_token text, add column email_change_token_new text, add column email_change text;
create table auth.identities (id uuid primary key, user_id uuid references auth.users on delete cascade, provider_id text, provider text, identity_data jsonb, created_at timestamptz, updated_at timestamptz);
-- extras needed by migration 005 (task files): a stand-in for Supabase Storage's tables
create schema if not exists storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets, name text, owner uuid default auth.uid(), owner_id text default auth.uid()::text);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, anon;
grant select, insert, update, delete on storage.objects to authenticated;
