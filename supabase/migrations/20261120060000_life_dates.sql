-- =============================================================================
-- Birth and death dates ("life dates"), with privacy rules.
--
-- Genealogy dates are often partial or uncertain, so a date is stored as
-- separate parts plus a qualifier (exact / about / before / after):
--   "1952", "about 1930", "March 1952", "14 March 1952", or just "14 March"
--   (a birthday whose year isn't known).
--
-- Privacy (from the project plan: birth dates are for immediate family):
--   events       type, YEAR and qualifier  -> every member of the tree
--                (enough for ages and for "older or younger")
--   event_dates  MONTH and DAY             -> only:
--                  * the person themselves (if they claimed their profile)
--                  * their immediate family: parents, children, partners and
--                    siblings of the signed-in user's own profile in the tree
--                  * everyone in the tree, once the person is deceased
--
-- Dates are written only through the functions below (no direct writes), so
-- the checks can't be bypassed. create_tree_with_me, add_relative and
-- save_person are re-created here with extra p_birth / p_death parameters.
--
-- Tests: tests/db/lifeDates.test.ts
-- =============================================================================

create type public.event_type as enum ('birth', 'death');
create type public.date_qualifier as enum ('exact', 'about', 'before', 'after');

create table public.events (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid not null references public.persons (id) on delete cascade,
  type          public.event_type not null,
  year          smallint check (year between 1 and 2200),
  qualifier     public.date_qualifier not null default 'exact',
  -- Whether a day/month exists, even if the viewer may not see it, so the app
  -- can say "only visible to close family" instead of showing nothing.
  has_full_date boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (person_id, type)
);

create table public.event_dates (
  event_id uuid primary key references public.events (id) on delete cascade,
  month    smallint not null check (month between 1 and 12),
  day      smallint check (day between 1 and 31)
);

create trigger events_set_updated_at
before update on public.events
for each row execute function private.set_updated_at();


-- -----------------------------------------------------------------------------
-- Who may see the day and month
-- -----------------------------------------------------------------------------
create function private.can_see_full_dates(p_person_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.persons p
    where p.id = p_person_id
      and private.is_tree_member(p.tree_id)
      and (
        p.living_status = 'deceased'
        or p.claimed_by_user_id = (select auth.uid())
        or exists (
          -- the signed-in user's own profile in the same tree ...
          select 1 from public.persons me
          where me.tree_id = p.tree_id and me.claimed_by_user_id = (select auth.uid())
            and (
              -- ... is linked directly (parent, child, partner, sibling) ...
              exists (
                select 1 from public.relationships r
                where r.type <> 'friend'
                  and ((r.person_a = me.id and r.person_b = p.id) or (r.person_b = me.id and r.person_a = p.id))
              )
              -- ... or shares a parent (a sibling not linked directly).
              or exists (
                select 1 from public.relationships r1
                join public.relationships r2 on r2.person_a = r1.person_a
                where r1.type = 'parent' and r2.type = 'parent'
                  and r1.person_b = me.id and r2.person_b = p.id
              )
            )
        )
      )
  );
$$;

revoke all on function private.can_see_full_dates(uuid) from public;
grant execute on function private.can_see_full_dates(uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- Access: read-only for signed-in users, filtered by the policies.
-- -----------------------------------------------------------------------------
revoke all on public.events, public.event_dates from anon, authenticated;
grant select on public.events, public.event_dates to authenticated;

alter table public.events      enable row level security;
alter table public.event_dates enable row level security;

create policy "Members can view the years of life events in their trees"
  on public.events for select to authenticated
  using (private.can_view_person(person_id));

create policy "Day and month only for the person, close family, or once deceased"
  on public.event_dates for select to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_id and private.can_see_full_dates(e.person_id)
    )
  );


-- -----------------------------------------------------------------------------
-- set_life_date: the one place where dates are written.
--
-- p_date: {"year": 1952, "month": 3, "day": 14, "qualifier": "about"}
--         Any part may be missing, but there must be a year, or a month and
--         a day. null removes the date.
-- If the caller can't see an existing day/month, sending only a year keeps
-- the hidden day/month (so editing a name can't wipe a birthday by accident).
-- -----------------------------------------------------------------------------
create function private.set_life_date(p_person uuid, p_type public.event_type, p_date jsonb)
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
      -- 2000 is a leap year, so 29 February is allowed when the year is unknown.
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
  elsif private.can_see_full_dates(p_person) then
    -- Only someone who can see the day/month may remove it.
    delete from public.event_dates where event_id = v_event;
    update public.events set has_full_date = false where id = v_event;
  end if;

  -- A death can't come before a birth (compared by year).
  select e.year into v_birth from public.events e where e.person_id = p_person and e.type = 'birth';
  select e.year into v_death from public.events e where e.person_id = p_person and e.type = 'death';
  if v_birth is not null and v_death is not null and v_death < v_birth then
    raise exception 'A death date can''t be before the birth date' using errcode = 'check_violation';
  end if;
end;
$$;

revoke all on function private.set_life_date(uuid, public.event_type, jsonb) from public;
grant execute on function private.set_life_date(uuid, public.event_type, jsonb) to authenticated;


-- -----------------------------------------------------------------------------
-- Re-create the three saving functions with date parameters.
-- (Their bodies are the same as before, plus the date calls at the end.)
-- -----------------------------------------------------------------------------
drop function public.create_tree_with_me(text, text, jsonb, public.sex);

create function public.create_tree_with_me(
  p_tree_name   text,
  p_tree_locale text,
  p_names       jsonb,
  p_sex         public.sex default 'unknown',
  p_birth       jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := (select auth.uid());
  v_tree   uuid;
  v_person uuid;
  v_name   jsonb;
  v_index  int := 0;
begin
  if v_user is null then
    raise exception 'You must be signed in' using errcode = 'insufficient_privilege';
  end if;
  if p_names is null or jsonb_typeof(p_names) <> 'array' or jsonb_array_length(p_names) = 0 then
    raise exception 'At least one name is required' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_names) > 10 then
    raise exception 'At most 10 names' using errcode = 'check_violation';
  end if;

  insert into public.trees (name, default_locale, created_by)
  values (trim(p_tree_name), coalesce(p_tree_locale, 'en'), v_user)
  returning id into v_tree;

  insert into public.persons (tree_id, claimed_by_user_id, sex, living_status, created_by)
  values (v_tree, v_user, coalesce(p_sex, 'unknown'), 'living', v_user)
  returning id into v_person;

  for v_name in select value from jsonb_array_elements(p_names)
  loop
    insert into public.person_names
      (person_id, type, given, family, full_display, script, lang, is_primary)
    values (
      v_person,
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

  if p_birth is not null then
    perform private.set_life_date(v_person, 'birth', p_birth);
  end if;

  return v_tree;
end;
$$;

revoke all on function public.create_tree_with_me(text, text, jsonb, public.sex, jsonb) from public, anon;
grant execute on function public.create_tree_with_me(text, text, jsonb, public.sex, jsonb) to authenticated;


drop function public.add_relative(
  uuid, text, public.relationship_subtype, jsonb, public.sex, public.living_status, public.certainty, uuid
);

create function public.add_relative(
  p_anchor       uuid,
  p_relation     text,
  p_subtype      public.relationship_subtype,
  p_names        jsonb,
  p_sex          public.sex default 'unknown',
  p_living       public.living_status default 'living',
  p_certainty    public.certainty default 'confirmed',
  p_other_parent uuid default null,
  p_birth        jsonb default null,
  p_death        jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tree   uuid;
  v_person uuid;
  v_name   jsonb;
  v_index  int := 0;
begin
  if p_relation not in ('parent', 'child', 'partner', 'sibling', 'friend') then
    raise exception 'Unknown relation: %', p_relation using errcode = 'check_violation';
  end if;
  if p_other_parent is not null and p_relation <> 'child' then
    raise exception 'A second parent only applies when adding a child' using errcode = 'check_violation';
  end if;

  select p.tree_id into v_tree from public.persons p where p.id = p_anchor;
  if v_tree is null then
    raise exception 'Person not found' using errcode = 'no_data_found';
  end if;

  if p_names is null or jsonb_typeof(p_names) <> 'array' or jsonb_array_length(p_names) = 0 then
    raise exception 'At least one name is required' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_names) > 10 then
    raise exception 'At most 10 names' using errcode = 'check_violation';
  end if;

  insert into public.persons (tree_id, sex, living_status)
  values (v_tree, coalesce(p_sex, 'unknown'), coalesce(p_living, 'living'))
  returning id into v_person;

  for v_name in select value from jsonb_array_elements(p_names)
  loop
    insert into public.person_names
      (person_id, type, given, family, full_display, script, lang, is_primary)
    values (
      v_person,
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

  if p_relation = 'parent' then
    insert into public.relationships (tree_id, person_a, person_b, type, subtype, certainty)
    values (v_tree, v_person, p_anchor, 'parent', p_subtype, p_certainty);
  elsif p_relation = 'child' then
    insert into public.relationships (tree_id, person_a, person_b, type, subtype, certainty)
    values (v_tree, p_anchor, v_person, 'parent', p_subtype, p_certainty);
    if p_other_parent is not null then
      insert into public.relationships (tree_id, person_a, person_b, type, subtype, certainty)
      values (v_tree, p_other_parent, v_person, 'parent', p_subtype, p_certainty);
    end if;
  else
    insert into public.relationships (tree_id, person_a, person_b, type, subtype, certainty)
    values (
      v_tree,
      least(p_anchor, v_person),
      greatest(p_anchor, v_person),
      p_relation::public.relationship_type,
      case when p_relation = 'friend' then null else p_subtype end,
      p_certainty
    );
  end if;

  if p_birth is not null then
    perform private.set_life_date(v_person, 'birth', p_birth);
  end if;
  if p_death is not null then
    perform private.set_life_date(v_person, 'death', p_death);
  end if;

  return v_person;
end;
$$;

revoke all on function public.add_relative(
  uuid, text, public.relationship_subtype, jsonb, public.sex, public.living_status, public.certainty, uuid, jsonb, jsonb
) from public, anon;
grant execute on function public.add_relative(
  uuid, text, public.relationship_subtype, jsonb, public.sex, public.living_status, public.certainty, uuid, jsonb, jsonb
) to authenticated;


drop function public.save_person(uuid, jsonb, public.sex, public.living_status);

-- p_birth / p_death: the date to keep (null = no date, removes it).
create function public.save_person(
  p_person uuid,
  p_names  jsonb,
  p_sex    public.sex,
  p_living public.living_status,
  p_birth  jsonb default null,
  p_death  jsonb default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated int;
  v_name    jsonb;
  v_index   int := 0;
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
  set sex = coalesce(p_sex, sex), living_status = coalesce(p_living, living_status)
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
end;
$$;

revoke all on function public.save_person(uuid, jsonb, public.sex, public.living_status, jsonb, jsonb) from public, anon;
grant execute on function public.save_person(uuid, jsonb, public.sex, public.living_status, jsonb, jsonb) to authenticated;
