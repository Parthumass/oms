-- =====================================================================
-- 012: more than one teacher on a class, and handing a class date to
-- another teacher. Run after 011. Safe to re-run.
--
-- Extra teachers (class_teachers): added by the centre lead or admin
--   team. They can do everything the class's main volunteer can: see
--   the students, mark attendance, enter marks.
-- Cover (class_covers): "I cannot take my class on this date, X will".
--   Made by a teacher of the class, the centre lead or the admin team.
--   The covering teacher can see the class and mark that date, and the
--   class is counted in their hours.
-- =====================================================================

create table if not exists public.class_teachers (
  class_id     uuid not null references public.classes on delete cascade,
  volunteer_id uuid not null references public.volunteers on delete cascade,
  added_by     uuid default auth.uid(),
  added_at     timestamptz not null default now(),
  primary key (class_id, volunteer_id)
);
create index if not exists class_teachers_volunteer_idx on public.class_teachers (volunteer_id);

create table if not exists public.class_covers (
  id             uuid primary key default gen_random_uuid(),
  class_id       uuid not null references public.classes on delete cascade,
  cover_date     date not null,
  volunteer_id   uuid not null references public.volunteers on delete cascade,   -- who takes the class
  volunteer_name text,
  given_by       uuid default auth.uid(),
  given_by_name  text,
  note           text,
  created_at     timestamptz not null default now(),
  unique (class_id, cover_date)
);
create index if not exists class_covers_volunteer_idx on public.class_covers (volunteer_id);

alter table public.class_teachers enable row level security;
alter table public.class_covers enable row level security;

-- A teacher of the class: the main volunteer or an extra teacher.
create or replace function app.is_class_volunteer(cls uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.classes c
                 where c.id = cls and c.volunteer_id = app.my_volunteer())
      or exists (select 1 from public.class_teachers t
                 where t.class_id = cls and t.volunteer_id = app.my_volunteer())
$$;

-- A teacher of the class, or someone who has covered or will cover a date.
create or replace function app.teaches_class(cls uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_class_volunteer(cls)
      or exists (select 1 from public.sessions s
                 where s.class_id = cls and s.taught_by = app.my_volunteer())
      or exists (select 1 from public.class_covers k
                 where k.class_id = cls and k.volunteer_id = app.my_volunteer())
$$;

-- Who is covering this class on this date, if anyone.
create or replace function app.cover_for(cls uuid, d date) returns uuid
language sql stable security definer set search_path = '' as $$
  select volunteer_id from public.class_covers where class_id = cls and cover_date = d
$$;

-- A class date being added takes its covering teacher from the cover.
create or replace function app.session_takes_cover() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.taught_by is null then
    new.taught_by := app.cover_for(new.class_id, new.session_date);
  end if;
  return new;
end $$;
drop trigger if exists sessions_take_cover on public.sessions;
create trigger sessions_take_cover before insert on public.sessions
  for each row execute function app.session_takes_cover();

-- A cover made, changed or removed updates a class date that already exists.
create or replace function app.cover_updates_session() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.sessions set taught_by = null
     where class_id = old.class_id and session_date = old.cover_date and taught_by = old.volunteer_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update public.sessions set taught_by = new.volunteer_id
     where class_id = new.class_id and session_date = new.cover_date;
    return new;
  end if;
  return old;
end $$;
drop trigger if exists class_covers_session on public.class_covers;
create trigger class_covers_session after insert or update or delete on public.class_covers
  for each row execute function app.cover_updates_session();

-- A class date may be added by: admin team, centre lead, a teacher of
-- the class, or the teacher covering that date.
drop policy if exists ins on public.sessions;
create policy ins on public.sessions for insert to authenticated
  with check ((select app.is_staff())
           or app.is_lead_of(app.class_centre(class_id))
           or (app.is_class_volunteer(class_id)
               and (taught_by is null or taught_by = app.cover_for(class_id, session_date)))
           or (taught_by = (select app.my_volunteer())
               and taught_by = app.cover_for(class_id, session_date)));

drop policy if exists read on public.class_teachers;
create policy read on public.class_teachers for select to authenticated
  using (app.can_read_class(class_id));
drop policy if exists manage on public.class_teachers;
create policy manage on public.class_teachers for all to authenticated
  using      ((select app.is_staff()) or app.is_lead_of(app.class_centre(class_id)))
  with check ((select app.is_staff()) or app.is_lead_of(app.class_centre(class_id)));

drop policy if exists read on public.class_covers;
create policy read on public.class_covers for select to authenticated
  using (app.can_read_class(class_id));
drop policy if exists ins on public.class_covers;
create policy ins on public.class_covers for insert to authenticated
  with check ((select app.is_staff())
           or app.is_lead_of(app.class_centre(class_id))
           or (app.is_class_volunteer(class_id) and cover_date >= current_date - 1));
drop policy if exists del on public.class_covers;
create policy del on public.class_covers for delete to authenticated
  using ((select app.is_staff())
      or app.is_lead_of(app.class_centre(class_id))
      or (app.is_class_volunteer(class_id) and cover_date >= current_date - 1));

-- Teachers cannot see the volunteer list, so this gives the names a
-- teacher may hand a class to: active volunteers of the class's centre.
create or replace function public.cover_candidates(p_class uuid)
returns table (id uuid, full_name text, code text)
language sql stable security definer set search_path = '' as $$
  select v.id, v.full_name, v.code
    from public.volunteers v
    join public.classes c on c.id = p_class
   where v.status = 'Active'
     and (v.centre_id = c.centre_id or v.centre_id is null
          or exists (select 1 from public.class_teachers t where t.class_id = c.id and t.volunteer_id = v.id))
     and v.id is distinct from app.my_volunteer()
     and (app.is_staff() or app.is_lead_of(c.centre_id) or app.is_class_volunteer(c.id))
   order by v.full_name
$$;

-- Hand a class date to another teacher (or change who covers it).
create or replace function public.give_cover(p_class uuid, p_date date, p_volunteer uuid, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_name text; me_name text;
begin
  if not (app.is_staff() or app.is_lead_of(app.class_centre(p_class)) or app.is_class_volunteer(p_class)) then
    raise exception 'Only a teacher of this class or the centre lead can hand it over.';
  end if;
  if p_date < current_date - 1 and not (app.is_staff() or app.is_lead_of(app.class_centre(p_class))) then
    raise exception 'Choose today or a later date.';
  end if;
  select full_name into v_name from public.cover_candidates(p_class) where id = p_volunteer;
  if v_name is null then raise exception 'Choose an active volunteer of this centre.'; end if;
  select coalesce(full_name, email) into me_name from public.profiles where id = (select auth.uid());
  insert into public.class_covers (class_id, cover_date, volunteer_id, volunteer_name, given_by, given_by_name, note)
  values (p_class, p_date, p_volunteer, v_name, (select auth.uid()), me_name, nullif(trim(p_note), ''))
  on conflict (class_id, cover_date) do update
    set volunteer_id = excluded.volunteer_id, volunteer_name = excluded.volunteer_name,
        given_by = excluded.given_by, given_by_name = excluded.given_by_name, note = excluded.note
  returning id into v_id;
  return v_id;
end $$;

revoke all on public.class_teachers, public.class_covers from anon;
grant select, insert, update, delete on public.class_teachers to authenticated;
grant select, insert, delete on public.class_covers to authenticated;
revoke all on function app.session_takes_cover() from public, anon, authenticated;
revoke all on function app.cover_updates_session() from public, anon, authenticated;
revoke all on function public.cover_candidates(uuid) from public, anon;
revoke all on function public.give_cover(uuid, date, uuid, text) from public, anon;
grant execute on function public.cover_candidates(uuid), public.give_cover(uuid, date, uuid, text) to authenticated;
grant execute on function app.cover_for(uuid, date) to authenticated;
