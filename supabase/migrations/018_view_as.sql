-- =====================================================================
-- 018: "View as". A board member or admin can look at the portal exactly
-- as one volunteer, centre lead or partner login sees it, to check what
-- that person can and cannot see. Run after 017. Safe to re-run.
--
-- How it works: while it is switched on, every request the board member
-- makes is answered as if the chosen person had made it, and the request
-- is read-only, so nothing can be added, changed or deleted by mistake.
-- It switches off when they click "Back to my view", or by itself after
-- an hour. Every use is written to a log.
--
-- Only the admin team and board can use it, and never to view as another
-- admin or board member.
--
-- To switch the whole feature off in an emergency, run:
--   alter role authenticator reset pgrst.db_pre_request;
--   notify pgrst, 'reload config';
-- =====================================================================

create table if not exists app.view_as (
  user_id    uuid primary key references public.profiles on delete cascade,   -- who is looking
  target     uuid not null references public.profiles on delete cascade,      -- whose view they see
  started_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table app.view_as enable row level security;
revoke all on app.view_as from public, anon, authenticated;

create table if not exists public.view_as_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,
  user_name   text,
  target      uuid,
  target_name text,
  started_at  timestamptz not null default now()
);
alter table public.view_as_log enable row level security;
drop policy if exists read on public.view_as_log;
create policy read on public.view_as_log for select to authenticated using ((select app.is_admin()));
revoke all on public.view_as_log from anon, authenticated;
grant select on public.view_as_log to authenticated;

-- Runs at the start of every API request. If the signed-in person has
-- "view as" switched on, the request is answered as the chosen person and
-- made read-only. It must never stop a request, so any problem is ignored.
create or replace function public.portal_pre_request() returns void
language plpgsql security definer set search_path = '' as $$
declare
  claims text;
  sub text;
  t uuid;
  swapped text;
begin
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '');
    sub := nullif(current_setting('request.jwt.claim.sub', true), '');
    if sub is null and claims is not null then sub := claims::jsonb ->> 'sub'; end if;
    if sub is null then return; end if;
    select v.target into t from app.view_as v where v.user_id = sub::uuid and v.expires_at > now();
    if t is null then return; end if;
    -- switching it on or off is always done as yourself
    if coalesce(current_setting('request.path', true), '') in ('/rpc/view_as_start', '/rpc/view_as_stop') then return; end if;
    swapped := (coalesce(claims, '{}')::jsonb || jsonb_build_object('sub', t::text))::text;
  exception when others then
    return;
  end;
  -- Outside the block above on purpose: read-only set inside it would end with it.
  perform set_config('transaction_read_only', 'on', true);
  perform set_config('app.real_user', sub, true);
  perform set_config('request.jwt.claim.sub', t::text, true);
  perform set_config('request.jwt.claims', swapped, true);
end $$;

-- The person really signed in, even while viewing as someone else.
create or replace function app.real_uid() returns uuid
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('app.real_user', true), '')::uuid, (select auth.uid()))
$$;

-- Logins that can be viewed: active volunteer, centre lead and partner logins.
create or replace function public.view_as_choices()
returns table (id uuid, full_name text, code text, role text, title text, centre text)
language sql stable security definer set search_path = '' as $$
  select p.id, coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1)), p.code, p.role::text, p.title,
         coalesce(c.name, vc.name, pa.name)
    from public.profiles p
    left join public.centres c on c.id = p.centre_id
    left join public.volunteers v on v.id = p.volunteer_id
    left join public.centres vc on vc.id = v.centre_id
    left join public.partners pa on pa.id = p.partner_id
   where p.active and p.role in ('volunteer', 'centre_lead', 'partner')
     and exists (select 1 from public.profiles me where me.id = app.real_uid() and me.active and me.role in ('admin', 'board'))
   order by p.role, 2
$$;

create or replace function public.view_as_start(p_target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; t public.profiles;
begin
  select * into me from public.profiles where id = (select auth.uid()) and active;
  if not found or me.role not in ('admin', 'board') then
    raise exception 'Only the admin team and board can use View as.';
  end if;
  select * into t from public.profiles where id = p_target and active;
  if not found or t.role is null or t.role not in ('volunteer', 'centre_lead', 'partner') then
    raise exception 'Choose an active volunteer, centre lead or partner login.';
  end if;
  insert into app.view_as (user_id, target, expires_at) values (me.id, t.id, now() + interval '1 hour')
  on conflict (user_id) do update set target = excluded.target, started_at = now(), expires_at = excluded.expires_at;
  insert into public.view_as_log (user_id, user_name, target, target_name)
  values (me.id, coalesce(me.full_name, me.email), t.id, coalesce(t.full_name, t.email));
end $$;

create or replace function public.view_as_stop() returns void
language sql security definer set search_path = '' as $$
  delete from app.view_as where user_id = (select auth.uid())
$$;

-- Tells the screen whether "view as" is on, and for whom.
create or replace function public.view_as_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('target', v.target, 'expires_at', v.expires_at,
                            'real_name', coalesce(nullif(trim(me.full_name), ''), split_part(me.email, '@', 1)))
    from app.view_as v join public.profiles me on me.id = v.user_id
   where v.user_id = app.real_uid() and v.expires_at > now()
$$;

revoke all on function public.view_as_start(uuid), public.view_as_stop(), public.view_as_status(), public.view_as_choices() from public, anon;
grant execute on function public.view_as_start(uuid), public.view_as_stop(), public.view_as_status(), public.view_as_choices() to authenticated;
grant execute on function app.real_uid() to authenticated;
-- every request calls this, signed in or not
grant execute on function public.portal_pre_request() to anon, authenticated, service_role;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute $q$alter role authenticator set pgrst.db_pre_request = 'public.portal_pre_request'$q$;
  end if;
end $$;
notify pgrst, 'reload config';
