-- =============================================================================
-- Relationships between people in a tree, plus add_relative().
--
-- A family is a graph, not a strict tree (remarriage, adoption, friends), so
-- relationships are typed links between two people:
--   parent   person_a is the parent of person_b   (biological/adoptive/step/foster)
--   partner  either way                           (married/unmarried/divorced/widowed)
--   sibling  either way                           (full/half/step/adoptive)
--   friend   either way                           (no subtype)
-- "Child" is not stored separately: it is a parent link read from the other end.
-- Links that go both ways are stored once, with person_a < person_b.
--
-- Rules enforced here:
--   * both people in the same tree as the link; nobody linked to themselves
--   * no duplicate links
--   * nobody can be their own ancestor (no loops of parent links)
--   * at most two biological parents per person
--   * members can view links; owners and editors can add, change and remove
--     them (also for claimed people: links are the family's shared structure)
--
-- Tests: tests/db/relationships.test.ts
-- =============================================================================

create type public.relationship_type as enum ('parent', 'partner', 'sibling', 'friend');
create type public.relationship_subtype as enum (
  'biological', 'adoptive', 'step', 'foster',   -- parent (and sibling: step, adoptive)
  'married', 'unmarried', 'divorced', 'widowed', -- partner
  'full', 'half'                                 -- sibling
);
create type public.certainty as enum ('confirmed', 'probable', 'uncertain');

create table public.relationships (
  id         uuid primary key default gen_random_uuid(),
  tree_id    uuid not null references public.trees (id) on delete cascade,
  person_a   uuid not null references public.persons (id) on delete cascade,
  person_b   uuid not null references public.persons (id) on delete cascade,
  type       public.relationship_type not null,
  subtype    public.relationship_subtype,
  certainty  public.certainty not null default 'confirmed',
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint relationships_not_self check (person_a <> person_b),
  constraint relationships_subtype_fits_type check (
    case type
      when 'parent'  then subtype is not null and subtype in ('biological', 'adoptive', 'step', 'foster')
      when 'partner' then subtype is not null and subtype in ('married', 'unmarried', 'divorced', 'widowed')
      when 'sibling' then subtype is not null and subtype in ('full', 'half', 'step', 'adoptive')
      when 'friend'  then subtype is null
    end
  ),
  -- Two-way links are stored once, in a fixed order.
  constraint relationships_two_way_ordered check (type = 'parent' or person_a < person_b)
);

create unique index relationships_unique_link on public.relationships (person_a, person_b, type);
create index relationships_person_b_idx on public.relationships (person_b);
create index relationships_tree_id_idx on public.relationships (tree_id);


-- -----------------------------------------------------------------------------
-- Checks that need to look at other rows
-- -----------------------------------------------------------------------------
create function private.check_relationship()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
       new.person_a <> old.person_a or new.person_b <> old.person_b
       or new.type <> old.type or new.tree_id <> old.tree_id
     ) then
    raise exception 'Who a link connects can''t be changed; remove it and add a new one'
      using errcode = 'check_violation';
  end if;

  -- (A link to oneself is left to the relationships_not_self check.)
  if new.person_a <> new.person_b and (select count(*) from public.persons p
      where p.id in (new.person_a, new.person_b) and p.tree_id = new.tree_id) <> 2 then
    raise exception 'Both people must be in the same tree as the link'
      using errcode = 'check_violation';
  end if;

  if new.type = 'parent' then
    -- Adding "A is parent of B" makes a loop if B is already an ancestor of A.
    if exists (
      with recursive ancestors(id) as (
        select r.person_a from public.relationships r
        where r.person_b = new.person_a and r.type = 'parent' and r.id <> new.id
        union
        select r.person_a from public.relationships r
        join ancestors a on r.person_b = a.id
        where r.type = 'parent' and r.id <> new.id
      )
      select 1 from ancestors where id = new.person_b
    ) then
      raise exception 'That would make someone their own ancestor'
        using errcode = 'check_violation';
    end if;

    if new.subtype = 'biological' and (
      select count(*) from public.relationships r
      where r.person_b = new.person_b and r.type = 'parent'
        and r.subtype = 'biological' and r.id <> new.id
    ) >= 2 then
      raise exception 'A person can have at most two biological parents'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger relationships_check
before insert or update on public.relationships
for each row execute function private.check_relationship();

create trigger relationships_set_updated_at
before update on public.relationships
for each row execute function private.set_updated_at();


-- -----------------------------------------------------------------------------
-- Access and policies
-- -----------------------------------------------------------------------------
revoke all on public.relationships from anon;
grant select, insert, update, delete on public.relationships to authenticated;

alter table public.relationships enable row level security;

create policy "Members can view links in their trees"
  on public.relationships for select to authenticated
  using (private.is_tree_member(tree_id));

create policy "Owners and editors can add links"
  on public.relationships for insert to authenticated
  with check (private.can_edit_tree(tree_id));

create policy "Owners and editors can change links"
  on public.relationships for update to authenticated
  using (private.can_edit_tree(tree_id))
  with check (private.can_edit_tree(tree_id));

create policy "Owners and editors can remove links"
  on public.relationships for delete to authenticated
  using (private.can_edit_tree(tree_id));


-- -----------------------------------------------------------------------------
-- add_relative: add a new person related to an existing one, in one go.
--
-- p_relation is how the NEW person relates to p_anchor:
--   'parent' | 'child' | 'partner' | 'sibling' | 'friend'
-- For 'child', p_other_parent can link a second parent (e.g. the anchor's
-- partner) at the same time.
--
-- Runs with the caller's own rights (security invoker), so all the normal
-- privacy rules apply: viewers and outsiders can't add anyone.
-- -----------------------------------------------------------------------------
create function public.add_relative(
  p_anchor       uuid,
  p_relation     text,
  p_subtype      public.relationship_subtype,
  p_names        jsonb,
  p_sex          public.sex default 'unknown',
  p_living       public.living_status default 'living',
  p_certainty    public.certainty default 'confirmed',
  p_other_parent uuid default null
)
returns uuid -- the new person's id
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

  -- Only finds people the caller is allowed to see.
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

  return v_person;
end;
$$;

revoke all on function public.add_relative(
  uuid, text, public.relationship_subtype, jsonb, public.sex, public.living_status, public.certainty, uuid
) from public, anon;
grant execute on function public.add_relative(
  uuid, text, public.relationship_subtype, jsonb, public.sex, public.living_status, public.certainty, uuid
) to authenticated;
