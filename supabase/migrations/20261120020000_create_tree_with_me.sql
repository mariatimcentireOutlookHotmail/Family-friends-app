-- =============================================================================
-- create_tree_with_me: create a family tree with yourself as its first person.
--
-- In one go (all or nothing):
--   1. creates the tree (the trees trigger makes you its owner),
--   2. adds a person for you, claimed by your account and marked living,
--   3. saves your names; the first one is the main (primary) name.
--
-- Why a function: the table rules block app users from creating a claimed
-- person, so nobody can claim someone else. This function only ever claims
-- for the signed-in user (auth.uid()), never anyone else.
--
-- Called from the app as supabase.rpc("create_tree_with_me", {...}).
-- Tests: tests/db/createTree.test.ts
-- =============================================================================

create function public.create_tree_with_me(
  p_tree_name   text,
  p_tree_locale text,
  -- [{ "given": "...", "family": "...", "full_display": "...",
  --    "script": "Latn", "lang": "zh", "type": "birth" }, ...]
  p_names       jsonb,
  p_sex         public.sex default 'unknown'
)
returns uuid -- the new tree's id
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

  return v_tree;
end;
$$;

-- Only signed-in users may call it.
revoke all on function public.create_tree_with_me(text, text, jsonb, public.sex) from public, anon;
grant execute on function public.create_tree_with_me(text, text, jsonb, public.sex) to authenticated;
