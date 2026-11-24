-- =====================================================================
-- 027: email each volunteer a copy of the agreement they just signed.
-- Run after 026. Safe to re-run.
--
-- When a volunteer signs, an email with the full text they signed, their
-- typed name and the date and time is put in the outbox. It goes even if
-- they have switched off reminder emails, because it is their record.
-- The admin team can switch it off under Setup > Email.
-- =====================================================================

alter table public.mail_settings add column if not exists agreement_emails boolean not null default true;

create or replace function app.queue_agreement_email() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.mail_settings; doc public.volunteer_agreements; addr text; nm text; txt text;
begin
  select * into s from public.mail_settings;
  if s is null or not s.agreement_emails then return new; end if;
  select nullif(trim(coalesce(nullif(trim(p.contact_email), ''), nullif(trim(v.email), ''),
                              case when p.email not like '%@portal.pratyagra.org' then p.email end)), ''),
         coalesce(nullif(split_part(trim(p.full_name), ' ', 1), ''), 'there')
    into addr, nm
    from public.profiles p left join public.volunteers v on v.id = p.volunteer_id
   where p.id = new.profile_id;
  if addr is null or addr not like '%@%' then return new; end if;
  select * into doc from public.volunteer_agreements where version = new.version;

  -- "## Heading" lines become headings with a line under them
  select string_agg(case when l like '## %' then E'\n' || upper(substr(l, 4)) || E'\n' || repeat('-', least(length(l) - 3, 60)) else l end, E'\n' order by n)
    into txt
    from unnest(string_to_array(doc.body, E'\n')) with ordinality as t(l, n);

  insert into public.email_outbox (profile_id, to_email, subject, body, kind)
  values (new.profile_id, addr, 'Pratyagra: your signed volunteer agreement',
          'Hello ' || nm || E',\n\nThank you for signing the Pratyagra volunteer agreement. This email is your copy of what you signed. Please keep it.\n\n'
          || 'Signed by: ' || new.signed_name || E'\n'
          || 'Signed on: ' || to_char(new.signed_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH24:MI') || E' (India time)\n'
          || 'Version: ' || new.version || E'\n\n'
          || '==========================================================' || E'\n'
          || upper(doc.title) || E'\n'
          || '==========================================================' || E'\n'
          || coalesce(txt, '') || E'\n\n'
          || '----------------------------------------------------------' || E'\n'
          || 'Signed electronically in the Pratyagra portal by ' || new.signed_name || ' on '
          || to_char(new.signed_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH24:MI') || E' (India time).\n\n'
          || 'You can see this copy any time in the portal under "My volunteer agreement": ' || coalesce(s.portal_url, ''),
          'agreement');
  return new;
end $$;
drop trigger if exists agreement_signatures_email on public.agreement_signatures;
create trigger agreement_signatures_email after insert on public.agreement_signatures
  for each row execute function app.queue_agreement_email();
revoke all on function app.queue_agreement_email() from public, anon, authenticated;
