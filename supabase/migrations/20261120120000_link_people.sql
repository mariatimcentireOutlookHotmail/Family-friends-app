-- =============================================================================
-- link_people: connect people who are already in the tree, e.g. grandfather
-- and uncle as father and son. One call can connect one person to several
-- others (e.g. a new grandfather as the parent of all his children), all or
-- nothing, so it's one entry in History.
--
--   p_relation says what each of p_others is to p_person:
--   'parent'  → each other person is a parent of p_person
--   'child'   → each other person is a child of p_person
--   'partner' / 'sibling' / 'friend' → two-way
--
-- Runs with the caller's rights (security invoker), so the normal rules apply:
-- only owners and editors can add links, both people must be in the same
-- tree, no one can become their own ancestor, at most two biological parents.
-- Tests: tests/db/linkPeople.test.ts
-- =============================================================================

create function public.link_people(
  p_person    uuid,
  p_relation  text,
  p_others    uuid[],
  p_subtype   public.relationship_subtype default null,
  p_certainty public.certainty default 'confirmed'
)
returns int -- how many links were added
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tree  uuid;
  v_other uuid;
  v_count int := 0;
begin
  if p_relation not in ('parent', 'child', 'partner', 'sibling', 'friend') then
    raise exception 'Unknown relation: %', p_relation using errcode = 'check_violation';
  end if;
  if p_others is null or cardinality(p_others) = 0 then
    raise exception 'Choose at least one person' using errcode = 'check_violation';
  end if;
  if cardinality(p_others) > 50 then
    raise exception 'At most 50 people at once' using errcode = 'check_violation';
  end if;

  -- Only finds people the caller may see.
  select p.tree_id into v_tree from public.persons p where p.id = p_person;
  if v_tree is null then
    raise exception 'Person not found' using errcode = 'no_data_found';
  end if;

  foreach v_other in array p_others loop
    if v_other = p_person then
      raise exception 'A person can''t be linked to themselves' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.persons p where p.id = v_other and p.tree_id = v_tree) then
      raise exception 'Both people must be in the same tree' using errcode = 'check_violation';
    end if;

    if p_relation = 'parent' then
      insert into public.relationships (tree_id, person_a, person_b, type, subtype, certainty)
      values (v_tree, v_other, p_person, 'parent', p_subtype, p_certainty);
    elsif p_relation = 'child' then
      insert into public.relationships (tree_id, person_a, person_b, type, subtype, certainty)
      values (v_tree, p_person, v_other, 'parent', p_subtype, p_certainty);
    else
      insert into public.relationships (tree_id, person_a, person_b, type, subtype, certainty)
      values (v_tree, least(p_person, v_other), greatest(p_person, v_other),
              p_relation::public.relationship_type,
              case when p_relation = 'friend' then null else p_subtype end,
              p_certainty);
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.link_people(uuid, text, uuid[], public.relationship_subtype, public.certainty) from public, anon;
grant execute on function public.link_people(uuid, text, uuid[], public.relationship_subtype, public.certainty) to authenticated;
