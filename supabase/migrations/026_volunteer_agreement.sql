-- =====================================================================
-- 026: the volunteer agreement. Run after 025. Safe to re-run.
--
-- The admin team or board publishes the agreement text (Volunteers page >
-- Volunteer agreement). Every volunteer login is then asked to read and
-- sign it on their next sign-in, before they can use the portal: they tick
-- each section and type their full name. Each signature is kept with the
-- version they signed and the date and time.
--
-- Publishing new text makes a new version. Small corrections can be
-- published without asking anyone to sign again; otherwise everyone signs
-- the new version on their next sign-in. Old versions are never changed,
-- so a signed copy always shows exactly what was signed.
--
-- Nothing is asked until the first version is published.
-- =====================================================================

create table if not exists public.volunteer_agreements (
  version           integer primary key,
  title             text not null,
  body              text not null,
  resign            boolean not null default true,   -- everyone signs this version again
  published_at      timestamptz not null default now(),
  published_by_name text
);
alter table public.volunteer_agreements enable row level security;
drop policy if exists read on public.volunteer_agreements;
create policy read on public.volunteer_agreements for select to authenticated
  using ((select app.my_role()) is not null and (select app.my_role()) <> 'partner');
revoke all on public.volunteer_agreements from anon;
revoke insert, update, delete on public.volunteer_agreements from authenticated;
grant select on public.volunteer_agreements to authenticated;

create table if not exists public.agreement_signatures (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles on delete cascade,
  volunteer_id uuid references public.volunteers on delete set null,
  version      integer not null references public.volunteer_agreements,
  signed_name  text not null,
  signed_at    timestamptz not null default now(),
  unique (profile_id, version)
);
alter table public.agreement_signatures enable row level security;
drop policy if exists read on public.agreement_signatures;
create policy read on public.agreement_signatures for select to authenticated
  using ((select app.is_staff())
      or profile_id = (select auth.uid())
      or (volunteer_id is not null and exists (select 1 from public.volunteers v where v.id = volunteer_id and v.centre_id is not null and app.is_lead_of(v.centre_id))));
revoke all on public.agreement_signatures from anon;
revoke insert, update, delete on public.agreement_signatures from authenticated;
grant select on public.agreement_signatures to authenticated;

-- The version everyone must have signed (or a later one).
create or replace function app.agreement_required_version() returns integer
language sql stable security definer set search_path = '' as $$
  select max(version) from public.volunteer_agreements where resign
$$;

-- For the signed-in person: do they need to sign, and what.
create or replace function public.my_agreement_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles; req integer; latest public.volunteer_agreements; signed integer;
begin
  select * into me from public.profiles where id = (select auth.uid()) and active;
  if not found or me.role is null or not (me.role = 'volunteer' or me.volunteer_id is not null) then
    return jsonb_build_object('needed', false);
  end if;
  req := app.agreement_required_version();
  if req is null then return jsonb_build_object('needed', false); end if;
  select max(version) into signed from public.agreement_signatures where profile_id = me.id;
  if signed is not null and signed >= req then
    return jsonb_build_object('needed', false, 'signed_version', signed);
  end if;
  select * into latest from public.volunteer_agreements order by version desc limit 1;
  return jsonb_build_object('needed', true, 'version', latest.version, 'title', latest.title, 'body', latest.body,
                            'resigning', signed is not null, 'name', me.full_name);
end $$;

create or replace function public.sign_agreement(p_version integer, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; latest integer;
begin
  select * into me from public.profiles where id = (select auth.uid()) and active;
  if not found or me.role is null then raise exception 'Please sign in again.'; end if;
  select max(version) into latest from public.volunteer_agreements;
  if latest is null or p_version is distinct from latest then raise exception 'The agreement has just been updated. Please read the new version.'; end if;
  if length(trim(coalesce(p_name, ''))) < 3 then raise exception 'Please type your full name to sign.'; end if;
  insert into public.agreement_signatures (profile_id, volunteer_id, version, signed_name)
  values (me.id, me.volunteer_id, p_version, left(trim(p_name), 120))
  on conflict (profile_id, version) do nothing;
end $$;

-- Admin team / board: publish the agreement (a new version each time).
create or replace function public.publish_agreement(p_title text, p_body text, p_resign boolean default true) returns integer
language plpgsql security definer set search_path = '' as $$
declare v integer; who text;
begin
  if not app.is_staff() then raise exception 'Only the admin team or the board can change the volunteer agreement.'; end if;
  if length(trim(coalesce(p_body, ''))) < 20 then raise exception 'The agreement text is empty.'; end if;
  select coalesce(max(version), 0) + 1 into v from public.volunteer_agreements;
  select coalesce(nullif(trim(full_name), ''), email) into who from public.profiles where id = (select auth.uid());
  insert into public.volunteer_agreements (version, title, body, resign, published_by_name)
  values (v, coalesce(nullif(trim(p_title), ''), 'Volunteer agreement'), p_body, v = 1 or coalesce(p_resign, true), who);
  return v;
end $$;

revoke all on function app.agreement_required_version() from public, anon, authenticated;
revoke all on function public.my_agreement_status(), public.sign_agreement(integer, text), public.publish_agreement(text, text, boolean) from public, anon;
grant execute on function public.my_agreement_status(), public.sign_agreement(integer, text), public.publish_agreement(text, text, boolean) to authenticated;
