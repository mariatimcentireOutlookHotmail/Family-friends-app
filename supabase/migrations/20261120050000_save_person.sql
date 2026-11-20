-- =============================================================================
-- save_person: change a person's names, sex and living status in one go.
--
-- Names are replaced as a whole list (the first is the main name), all or
-- nothing, so a person can never end up with a half-saved list of names.
--
-- Runs with the caller's own rights (security invoker), so the normal rules
-- decide who may edit:
--   * unclaimed person: the tree's owners and editors
--   * claimed person: only the person who claimed it
--
-- Editing and removing links, and deleting people, use the tables directly;
-- their rules are in the earlier migrations.
--
-- Tests: tests/db/editPerson.test.ts
-- =============================================================================

create function public.save_person(
  p_person uuid,
  p_names  jsonb,
  p_sex    public.sex,
  p_living public.living_status
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
  -- The row is visible but the rules didn't let us change it.
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
end;
$$;

revoke all on function public.save_person(uuid, jsonb, public.sex, public.living_status) from public, anon;
grant execute on function public.save_person(uuid, jsonb, public.sex, public.living_status) to authenticated;
