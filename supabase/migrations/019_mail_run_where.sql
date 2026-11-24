-- =====================================================================
-- 019: fix for the email sender. The live database refuses an UPDATE
-- that has no WHERE clause, and mail_run had two of them. Same function,
-- with "where id" added (mail_settings only ever has one row).
-- Run after 018. Safe to re-run.
-- =====================================================================

-- Called by the sending script. Builds today's summaries once the hour has
-- come, then hands over what is waiting (never more than the daily cap).
create or replace function public.mail_run(p_secret text)
returns table (id uuid, to_email text, subject text, body text)
language plpgsql security definer set search_path = '' as $$
declare
  s public.mail_settings;
  ist timestamp := now() at time zone 'Asia/Kolkata';
  today date := (now() at time zone 'Asia/Kolkata')::date;
  r record;
  txt text;
  room integer;
begin
  if p_secret is null or p_secret <> (select m.secret from app.mail_secret m) then
    raise exception 'Not allowed.';
  end if;
  select * into s from public.mail_settings;
  update public.mail_settings ms set last_run = now() where ms.id;
  if not s.enabled then return; end if;

  if extract(hour from ist) >= s.send_hour_ist and s.last_digest_date is distinct from today then
    for r in select p.id, app.mail_address(p.id) as addr from public.profiles p loop
      continue when r.addr is null;
      txt := app.build_digest(r.id, today);
      continue when txt is null;
      insert into public.email_outbox (profile_id, to_email, subject, body, kind, for_date)
      values (r.id, r.addr, 'Pratyagra: your day, ' || to_char(today, 'DD Mon'), txt, 'digest', today)
      on conflict do nothing;
    end loop;
    update public.mail_settings ms set last_digest_date = today where ms.id;
  end if;

  select s.daily_cap - count(*) into room from public.email_outbox o
   where o.status in ('sending', 'sent') and (o.picked_at at time zone 'Asia/Kolkata')::date = today;
  return query
    update public.email_outbox o set status = 'sending', picked_at = now()
     where o.id in (select x.id from public.email_outbox x
                    where x.status = 'pending' or (x.status = 'sending' and x.picked_at < now() - interval '2 hours')
                    order by x.created_at limit greatest(0, least(40, room)))
    returning o.id, o.to_email, o.subject, o.body;
end $$;
