-- =============================================================================
-- Every person with photos has a profile photo, kept by the database itself:
--   * A new photo becomes the profile photo when the person has none.
--   * Deleting the profile photo makes the newest remaining photo the profile.
--   * Fixes existing people who have photos but no profile photo (this could
--     happen when a profile photo was deleted and another added right after).
-- Tests: tests/db/photos.test.ts
-- =============================================================================

create function private.media_default_profile()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not new.is_profile and not exists (
    select 1 from public.media m where m.person_id = new.person_id and m.is_profile
  ) then
    new.is_profile := true;
  end if;
  return new;
end;
$$;

create trigger media_default_profile before insert on public.media
  for each row execute function private.media_default_profile();

create function private.media_promote_profile()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.is_profile then
    update public.media set is_profile = true
    where id = (select m.id from public.media m
                where m.person_id = old.person_id
                order by m.created_at desc limit 1);
  end if;
  return null;
end;
$$;

create trigger media_promote_profile after delete on public.media
  for each row execute function private.media_promote_profile();

-- Existing people with photos but no profile photo: use their newest photo.
update public.media m set is_profile = true
where m.id in (
  select distinct on (x.person_id) x.id
  from public.media x
  where not exists (select 1 from public.media y where y.person_id = x.person_id and y.is_profile)
  order by x.person_id, x.created_at desc
);

revoke all on function private.media_default_profile() from public;
revoke all on function private.media_promote_profile() from public;
