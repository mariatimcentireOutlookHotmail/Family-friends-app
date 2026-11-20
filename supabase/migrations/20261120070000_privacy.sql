-- =============================================================================
-- Privacy defaults and per-field privacy levels, contact details, and minors.
--
-- 1. Per-field privacy levels (table field_visibility), for:
--      birth_date  the day and month of birth   default: immediate family
--                                                (whole tree once deceased)
--      death_date  the day and month of death   default: whole tree
--      contact     phone, email, address        default: private
--    Levels: private (only the person; for an unclaimed person, tree owners),
--            immediate (the person and their immediate family),
--            tree (every member of the tree).
--    Birth/death YEARS stay visible to the tree (needed for ages and for
--    elder/younger kinship words), except for protected minors.
--    Who may change a person's levels: the person who claimed the profile;
--    for an unclaimed person, the tree's owners.
--
-- 2. Contact details (table person_contacts).
--
-- 3. Minors: a living person whose age is below the limit for their country
--    (persons.country; 18 when unknown) is shown to everyone else as a
--    placeholder: their names, dates and contacts are visible only to
--    themselves, their immediate family, and whoever added them.
--
-- 4. my_access(person): what the signed-in user may see and do for a person,
--    readable as a field of persons, so the app can show the right controls.
--
-- Tests: tests/db/privacy.test.ts
-- =============================================================================

create type public.privacy_field as enum ('birth_date', 'death_date', 'contact');
create type public.privacy_level as enum ('private', 'immediate', 'tree');

-- ISO 3166 two-letter country code, used for the minors' age limit.
alter table public.persons add column country text check (country ~ '^[A-Z]{2}$');

create table public.person_contacts (
  person_id  uuid primary key references public.persons (id) on delete cascade,
  phone      text check (char_length(phone) <= 50),
  email      text check (char_length(email) <= 254),
  address    text check (char_length(address) <= 500),
  updated_at timestamptz not null default now()
);

create table public.field_visibility (
  person_id uuid not null references public.persons (id) on delete cascade,
  field     public.privacy_field not null,
  level     public.privacy_level not null,
  primary key (person_id, field)
);

-- Age below which someone counts as a minor, per country. Unknown: 18.
-- Sources checked Nov 2026: ID 18 (draft PDP regulation / child online
-- protection rules), CN 14 (PIPL art. 28/31), SG 13 (PDPC guidelines),
-- MY 18 (parental consent for under-18s), US 13 (COPPA). Not legal advice.
create table private.minor_age_limits (
  country text primary key check (country ~ '^[A-Z]{2}$'),
  age     smallint not null check (age between 1 and 21)
);
insert into private.minor_age_limits (country, age) values
  ('ID', 18), ('CN', 14), ('SG', 13), ('MY', 18), ('US', 13);


-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- The person is the signed-in user's own (claimed) profile.
create function private.is_self(p_person_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.persons p
    where p.id = p_person_id and p.claimed_by_user_id = (select auth.uid())
  );
$$;

-- The person is a parent, child, partner or sibling (linked directly or
-- through a shared parent) of the signed-in user's own profile in that tree.
create function private.is_immediate_family(p_person_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.persons p
    join public.persons me
      on me.tree_id = p.tree_id and me.claimed_by_user_id = (select auth.uid())
    where p.id = p_person_id
      and (
        exists (
          select 1 from public.relationships r
          where r.type <> 'friend'
            and ((r.person_a = me.id and r.person_b = p.id) or (r.person_b = me.id and r.person_a = p.id))
        )
        or exists (
          select 1 from public.relationships r1
          join public.relationships r2 on r2.person_a = r1.person_a
          where r1.type = 'parent' and r2.type = 'parent'
            and r1.person_b = me.id and r2.person_b = p.id
        )
      )
  );
$$;

-- Whether a living person is below the minors' age limit for their country.
-- Without a birth year we can't tell, so they are not treated as a minor.
-- With only a year, the youngest possible age is used (to err on the safe side).
create function private.is_minor(p_person_id uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_living  public.living_status;
  v_country text;
  v_year    int;
  v_month   int;
  v_day     int;
  v_age     int;
  v_limit   int;
begin
  select p.living_status, p.country into v_living, v_country from public.persons p where p.id = p_person_id;
  if v_living is null or v_living = 'deceased' then
    return false;
  end if;

  select e.year, d.month, d.day into v_year, v_month, v_day
  from public.events e left join public.event_dates d on d.event_id = e.id
  where e.person_id = p_person_id and e.type = 'birth';
  if v_year is null then
    return false;
  end if;

  if v_month is not null and v_day is not null then
    v_age := extract(year from age(current_date, make_date(v_year, v_month, v_day)))::int;
  else
    v_age := extract(year from current_date)::int - v_year - 1;
  end if;

  select l.age into v_limit from private.minor_age_limits l where l.country = v_country;
  return v_age < coalesce(v_limit, 18);
end;
$$;

-- Who may see a minor: themselves, immediate family, and whoever added them.
create function private.is_hidden_minor(p_person_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_minor(p_person_id)
     and not private.is_self(p_person_id)
     and not private.is_immediate_family(p_person_id)
     and not exists (
       select 1 from public.persons p
       where p.id = p_person_id and p.created_by = (select auth.uid())
     );
$$;

-- The level in force for a field: the person's own setting, or the default.
create function private.privacy_level_of(p_person_id uuid, p_field public.privacy_field)
returns public.privacy_level
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select v.level from public.field_visibility v where v.person_id = p_person_id and v.field = p_field),
    case p_field
      when 'contact' then 'private'::public.privacy_level
      when 'death_date' then 'tree'::public.privacy_level
      else case
        when (select p.living_status from public.persons p where p.id = p_person_id) = 'deceased'
          then 'tree'::public.privacy_level
        else 'immediate'::public.privacy_level
      end
    end
  );
$$;

-- Whether the signed-in user may see a field of a person.
create function private.can_see_field(p_person_id uuid, p_field public.privacy_field)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.can_view_person(p_person_id)
    and not private.is_hidden_minor(p_person_id)
    and case private.privacy_level_of(p_person_id, p_field)
      when 'tree' then true
      when 'immediate' then private.is_self(p_person_id) or private.is_immediate_family(p_person_id)
      else
        private.is_self(p_person_id)
        or exists (
          select 1 from public.persons p
          where p.id = p_person_id and p.claimed_by_user_id is null and private.is_tree_owner(p.tree_id)
        )
    end;
$$;

-- Who may change a person's privacy levels.
create function private.can_change_privacy(p_person_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_self(p_person_id)
      or exists (
        select 1 from public.persons p
        where p.id = p_person_id and p.claimed_by_user_id is null and private.is_tree_owner(p.tree_id)
      );
$$;

-- Hidden minors can't be edited by people who can't see them.
create or replace function private.can_edit_person(p_person_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.persons p
    where p.id = p_person_id
      and not private.is_hidden_minor(p.id)
      and case
        when p.claimed_by_user_id is not null
          then p.claimed_by_user_id = (select auth.uid())
        else private.can_edit_tree(p.tree_id)
      end
  );
$$;

-- Kept for older code: the day/month of birth.
create or replace function private.can_see_full_dates(p_person_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.can_see_field(p_person_id, 'birth_date');
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;


-- -----------------------------------------------------------------------------
-- Policies: names, years and dates follow the new rules
-- -----------------------------------------------------------------------------
drop policy "Members can view names of people in their trees" on public.person_names;
create policy "Members can view names, except of minors they may not see"
  on public.person_names for select to authenticated
  using (private.can_view_person(person_id) and not private.is_hidden_minor(person_id));

drop policy "Members can view the years of life events in their trees" on public.events;
create policy "Members can view years, except of minors they may not see"
  on public.events for select to authenticated
  using (private.can_view_person(person_id) and not private.is_hidden_minor(person_id));

drop policy "Day and month only for the person, close family, or once deceased" on public.event_dates;
create policy "Day and month follow the person's privacy level"
  on public.event_dates for select to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_id
        and private.can_see_field(
          e.person_id,
          case e.type when 'birth' then 'birth_date'::public.privacy_field else 'death_date'::public.privacy_field end
        )
    )
  );

drop policy "Editors edit unclaimed people; claimants edit themselves" on public.persons;
create policy "Editors edit unclaimed people; claimants edit themselves"
  on public.persons for update to authenticated
  using (
    not private.is_hidden_minor(id)
    and case when claimed_by_user_id is not null
      then claimed_by_user_id = (select auth.uid())
      else private.can_edit_tree(tree_id)
    end
  )
  with check (
    case when claimed_by_user_id is not null
      then claimed_by_user_id = (select auth.uid())
      else private.can_edit_tree(tree_id)
    end
  );

-- Contacts and privacy settings: read-only tables, written via functions.
revoke all on public.person_contacts, public.field_visibility from anon, authenticated;
grant select on public.person_contacts, public.field_visibility to authenticated;
alter table public.person_contacts enable row level security;
alter table public.field_visibility enable row level security;

create policy "Contacts follow the person's privacy level"
  on public.person_contacts for select to authenticated
  using (private.can_see_field(person_id, 'contact'));

create policy "Members can see the privacy settings of people in their trees"
  on public.field_visibility for select to authenticated
  using (private.can_view_person(person_id) and not private.is_hidden_minor(person_id));


-- -----------------------------------------------------------------------------
-- set_life_date: as before, but "can the caller see the day/month?" now
-- follows the field's privacy level (birth_date or death_date).
-- -----------------------------------------------------------------------------
create or replace function private.set_life_date(p_person uuid, p_type public.event_type, p_date jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_event uuid;
  v_year  int;
  v_month int;
  v_day   int;
  v_birth int;
  v_death int;
  v_field public.privacy_field := case p_type when 'birth' then 'birth_date'::public.privacy_field else 'death_date'::public.privacy_field end;
begin
  if not private.can_edit_person(p_person) then
    raise exception 'You can''t edit this person' using errcode = 'insufficient_privilege';
  end if;

  if p_date is null or jsonb_typeof(p_date) = 'null' then
    delete from public.events where person_id = p_person and type = p_type;
    return;
  end if;

  v_year  := nullif(p_date ->> 'year', '')::int;
  v_month := nullif(p_date ->> 'month', '')::int;
  v_day   := nullif(p_date ->> 'day', '')::int;

  if v_day is not null and v_month is null then
    raise exception 'A day needs a month' using errcode = 'check_violation';
  end if;
  if v_year is null and (v_month is null or v_day is null) then
    raise exception 'A date needs a year, or a month and a day' using errcode = 'check_violation';
  end if;
  if v_month is not null and v_day is not null then
    begin
      perform make_date(coalesce(v_year, 2000), v_month, v_day);
    exception when others then
      raise exception 'That date doesn''t exist' using errcode = 'check_violation';
    end;
  end if;

  insert into public.events (person_id, type, year, qualifier, has_full_date)
  values (
    p_person, p_type, v_year,
    coalesce(nullif(p_date ->> 'qualifier', '')::public.date_qualifier, 'exact'),
    v_month is not null
  )
  on conflict (person_id, type) do update
    set year = excluded.year, qualifier = excluded.qualifier
  returning id into v_event;

  if v_month is not null then
    insert into public.event_dates (event_id, month, day) values (v_event, v_month, v_day)
    on conflict (event_id) do update set month = excluded.month, day = excluded.day;
    update public.events set has_full_date = true where id = v_event;
  elsif private.can_see_field(p_person, v_field) then
    delete from public.event_dates where event_id = v_event;
    update public.events set has_full_date = false where id = v_event;
  end if;

  select e.year into v_birth from public.events e where e.person_id = p_person and e.type = 'birth';
  select e.year into v_death from public.events e where e.person_id = p_person and e.type = 'death';
  if v_birth is not null and v_death is not null and v_death < v_birth then
    raise exception 'A death date can''t be before the birth date' using errcode = 'check_violation';
  end if;
end;
$$;


-- -----------------------------------------------------------------------------
-- save_person gains p_details: {"country": "ID" | null,
--                               "contacts": {"phone", "email", "address"} }
-- null p_details = leave country and contacts unchanged. Contacts are only
-- changed if the caller may see them (so hidden contacts can't be wiped).
-- -----------------------------------------------------------------------------
drop function public.save_person(uuid, jsonb, public.sex, public.living_status, jsonb, jsonb);

create function public.save_person(
  p_person  uuid,
  p_names   jsonb,
  p_sex     public.sex,
  p_living  public.living_status,
  p_birth   jsonb default null,
  p_death   jsonb default null,
  p_details jsonb default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated  int;
  v_name     jsonb;
  v_index    int := 0;
  v_contacts jsonb;
begin
  if not exists (select 1 from public.persons p where p.id = p_person) then
    raise exception 'Person not found' using errcode = 'no_data_found';
  end if;

  if p_names is null or jsonb_typeof(p_names) <> 'array' or jsonb_array_length(p_names) = 0 then
    raise exception 'At least one name is required' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_names) > 10 then
    raise exception 'At most 10 names' using errcode = 'check_violation';
  end if;

  update public.persons
  set sex = coalesce(p_sex, sex),
      living_status = coalesce(p_living, living_status),
      country = case when p_details is null then country else nullif(p_details ->> 'country', '') end
  where id = p_person;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'You can''t edit this person' using errcode = 'insufficient_privilege';
  end if;

  delete from public.person_names where person_id = p_person;

  for v_name in select value from jsonb_array_elements(p_names)
  loop
    insert into public.person_names
      (person_id, type, given, family, full_display, script, lang, is_primary)
    values (
      p_person,
      coalesce(nullif(v_name ->> 'type', '')::public.name_type, 'birth'),
      nullif(trim(v_name ->> 'given'), ''),
      nullif(trim(v_name ->> 'family'), ''),
      trim(coalesce(v_name ->> 'full_display', '')),
      nullif(v_name ->> 'script', ''),
      nullif(v_name ->> 'lang', ''),
      v_index = 0
    );
    v_index := v_index + 1;
  end loop;

  perform private.set_life_date(p_person, 'birth', p_birth);
  perform private.set_life_date(p_person, 'death', p_death);

  v_contacts := p_details -> 'contacts';
  if v_contacts is not null and jsonb_typeof(v_contacts) = 'object' then
    perform private.set_contacts(p_person, v_contacts);
  end if;
end;
$$;

revoke all on function public.save_person(uuid, jsonb, public.sex, public.living_status, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_person(uuid, jsonb, public.sex, public.living_status, jsonb, jsonb, jsonb) to authenticated;

-- Contacts are written only here: by someone who may edit the person AND may
-- see their contacts. Empty fields are cleared; all empty removes the row.
create function private.set_contacts(p_person uuid, p_contacts jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_phone   text := nullif(trim(p_contacts ->> 'phone'), '');
  v_email   text := nullif(trim(p_contacts ->> 'email'), '');
  v_address text := nullif(trim(p_contacts ->> 'address'), '');
begin
  if not private.can_edit_person(p_person) then
    raise exception 'You can''t edit this person' using errcode = 'insufficient_privilege';
  end if;
  if not private.can_see_field(p_person, 'contact') then
    return; -- can't see them, so leave them as they are
  end if;
  if v_phone is null and v_email is null and v_address is null then
    delete from public.person_contacts where person_id = p_person;
  else
    insert into public.person_contacts (person_id, phone, email, address)
    values (p_person, v_phone, v_email, v_address)
    on conflict (person_id) do update
      set phone = excluded.phone, email = excluded.email, address = excluded.address, updated_at = now();
  end if;
end;
$$;

revoke all on function private.set_contacts(uuid, jsonb) from public;
grant execute on function private.set_contacts(uuid, jsonb) to authenticated;


-- -----------------------------------------------------------------------------
-- set_privacy: change one field's level (null = back to the default).
-- -----------------------------------------------------------------------------
create function public.set_privacy(p_person uuid, p_field public.privacy_field, p_level public.privacy_level)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.can_change_privacy(p_person) then
    raise exception 'Only this person, or a tree owner for an unclaimed profile, can change these settings'
      using errcode = 'insufficient_privilege';
  end if;
  if p_level is null then
    delete from public.field_visibility where person_id = p_person and field = p_field;
  else
    insert into public.field_visibility (person_id, field, level) values (p_person, p_field, p_level)
    on conflict (person_id, field) do update set level = excluded.level;
  end if;
end;
$$;

revoke all on function public.set_privacy(uuid, public.privacy_field, public.privacy_level) from public, anon;
grant execute on function public.set_privacy(uuid, public.privacy_field, public.privacy_level) to authenticated;


-- -----------------------------------------------------------------------------
-- my_access: what the signed-in user may see and do for a person. Selectable
-- as a field of persons (e.g. select id, my_access from persons).
-- -----------------------------------------------------------------------------
create function public.my_access(p public.persons)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when not private.can_view_person(p.id) then null else jsonb_build_object(
    'hiddenMinor', private.is_hidden_minor(p.id),
    'isMinor', case when private.is_hidden_minor(p.id) then true else private.is_minor(p.id) end,
    'canSeeContacts', private.can_see_field(p.id, 'contact'),
    'canChangePrivacy', private.can_change_privacy(p.id) and not private.is_hidden_minor(p.id),
    'levels', jsonb_build_object(
      'birth_date', private.privacy_level_of(p.id, 'birth_date'),
      'death_date', private.privacy_level_of(p.id, 'death_date'),
      'contact', private.privacy_level_of(p.id, 'contact')
    )
  ) end;
$$;

revoke all on function public.my_access(public.persons) from public, anon;
grant execute on function public.my_access(public.persons) to authenticated;
