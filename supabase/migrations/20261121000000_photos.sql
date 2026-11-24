-- =============================================================================
-- Photos.
--
--   * Files live in a private Storage bucket "media" at
--       <tree id>/<person id>/<photo id>.jpg        (full size, ≤1600 px)
--       <tree id>/<person id>/<photo id>_thumb.jpg  (thumbnail, ≤400 px)
--     The app resizes before uploading, so photos stay small (free tier).
--   * public.media has one row per photo: caption, who added it, and whether
--     it is the person's profile photo (at most one per person).
--   * Who sees photos: everyone who can see the person in the tree (the plan's
--     default: photos are visible to the whole tree). Never for a child the
--     viewer may not see.
--   * Who adds photos: owners and editors of the tree, and the person
--     themself once they've claimed their profile.
--   * Who changes or deletes a photo: whoever added it, the person themself,
--     and tree owners.
--   * The rules are on both the table and the files (storage.objects), so
--     nobody can fetch a file by guessing its path.
-- Tests: tests/db/photos.test.ts
-- =============================================================================

create table public.media (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.persons (id) on delete cascade,
  tree_id     uuid not null references public.trees (id) on delete cascade,
  path        text not null unique,
  thumb_path  text not null unique,
  width       int check (width between 1 and 10000),
  height      int check (height between 1 and 10000),
  caption     text check (char_length(caption) <= 500),
  -- Language the caption was written in (captions aren't translated).
  lang        text check (lang in ('en', 'id', 'zh-Hans')),
  is_profile  boolean not null default false,
  uploaded_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index media_person_idx on public.media (person_id, created_at desc);
create unique index media_one_profile_photo on public.media (person_id) where is_profile;

alter table public.media enable row level security;


-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- Can the caller see this person's photos?
create function private.can_view_media(p_person uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.can_view_person(p_person) and not private.is_hidden_minor(p_person);
$$;

-- Can the caller add photos of this person?
create function private.can_add_media(p_person uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.persons p
    where p.id = p_person
      and (private.can_edit_tree(p.tree_id) or p.claimed_by_user_id = (select auth.uid()))
      and not private.is_hidden_minor(p.id)
  );
$$;

-- Can the caller change or delete this photo?
create function private.can_manage_media(p_media uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.media m
    join public.persons p on p.id = m.person_id
    where m.id = p_media
      and not private.is_hidden_minor(p.id)
      and (m.uploaded_by = (select auth.uid())
           or p.claimed_by_user_id = (select auth.uid())
           or private.is_tree_owner(m.tree_id))
  );
$$;

-- "<tree>/<person>/<file>" → the person, if the path is well formed and the
-- person really is in that tree; otherwise null.
create function private.media_path_person(p_name text)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select p.id
  from public.persons p
  where p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}(_thumb)?\.jpg$'
    and p.id = split_part(p_name, '/', 2)::uuid
    and p.tree_id = split_part(p_name, '/', 1)::uuid;
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;


-- -----------------------------------------------------------------------------
-- Rules for the media table
-- -----------------------------------------------------------------------------
create policy "Those who can see the person can see their photos"
  on public.media for select to authenticated
  using (private.can_view_media(person_id));

create policy "Editors and the person can add photos"
  on public.media for insert to authenticated
  with check (
    private.can_add_media(person_id)
    and uploaded_by = (select auth.uid())
    and tree_id = (select p.tree_id from public.persons p where p.id = person_id)
    and path = tree_id || '/' || person_id || '/' || id || '.jpg'
    and thumb_path = tree_id || '/' || person_id || '/' || id || '_thumb.jpg'
  );

create policy "Uploader, the person and owners can change photos"
  on public.media for update to authenticated
  using (private.can_manage_media(id))
  with check (private.can_manage_media(id));

create policy "Uploader, the person and owners can delete photos"
  on public.media for delete to authenticated
  using (private.can_manage_media(id));

-- Which photo is the profile photo, and the caption, are all that can change.
create function private.media_fixed_columns()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.person_id <> old.person_id or new.tree_id <> old.tree_id or new.path <> old.path
     or new.thumb_path <> old.thumb_path or new.uploaded_by is distinct from old.uploaded_by then
    raise exception 'Only the caption and profile photo can be changed' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger media_fixed_columns before update on public.media
  for each row execute function private.media_fixed_columns();

-- Choosing a new profile photo: the app clears the old one first in the same
-- call (set_profile_photo), so the "one per person" rule holds.
create function public.set_profile_photo(p_media uuid)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_person uuid;
begin
  select m.person_id into v_person from public.media m where m.id = p_media;
  if v_person is null or not private.can_manage_media(p_media) then
    raise exception 'You can''t change this photo' using errcode = 'insufficient_privilege';
  end if;
  update public.media set is_profile = false where person_id = v_person and is_profile and id <> p_media;
  update public.media set is_profile = true where id = p_media;
end;
$$;
revoke all on function public.set_profile_photo(uuid) from public, anon;
grant execute on function public.set_profile_photo(uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- The bucket and the rules for the files themselves
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 5 * 1024 * 1024, array['image/jpeg'])
on conflict (id) do nothing;

create policy "Those who can see the person can see their photo files"
  on storage.objects for select to authenticated
  using (bucket_id = 'media' and private.can_view_media(private.media_path_person(name)));

create policy "Editors and the person can upload photo files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and private.can_add_media(private.media_path_person(name)));

create policy "Uploader, the person and owners can delete photo files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'media'
    and exists (select 1 from public.media m
                where (m.path = name or m.thumb_path = name) and private.can_manage_media(m.id))
  );
