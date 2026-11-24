-- =============================================================================
-- Stories and memorial profiles.
--
-- Stories: memories, a short bio, "how we met" — on a person's page. Kept in
-- the language they were written in (tagged, never translated).
--   * Everyone who can see the person can read them (never hidden minors).
--   * Written by owners and editors of the tree, and the person themself once
--     claimed. On a memorial profile, by any member of the tree.
--   * Edited by their author (and a memorial's stewards); deleted by their
--     author, the person, tree owners and a memorial's stewards.
--   * Logged in History like everything else, so a deleted story can be
--     brought back with Undo.
--
-- Memorial profiles: for someone who has died. Tree owners turn it on and
-- name stewards (members of the tree) who look after the profile: they can
-- tidy and remove stories and photos. Invites were already off for deceased
-- people.
-- Tests: tests/db/stories.test.ts
-- =============================================================================

create table public.memorials (
  person_id  uuid primary key references public.persons (id) on delete cascade,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.memorial_stewards (
  person_id uuid not null references public.memorials (person_id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  primary key (person_id, user_id)
);

create table public.stories (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references public.persons (id) on delete cascade,
  tree_id    uuid not null references public.trees (id) on delete cascade,
  title      text check (char_length(title) <= 120),
  body       text not null check (char_length(trim(body)) between 1 and 10000),
  lang       text not null default 'en' check (lang in ('en', 'id', 'zh-Hans')),
  author     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index stories_person_idx on public.stories (person_id, created_at desc);

create trigger stories_updated_at before update on public.stories
  for each row execute function private.set_updated_at();

alter table public.memorials enable row level security;
alter table public.memorial_stewards enable row level security;
alter table public.stories enable row level security;


-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

create function private.is_memorial(p_person uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memorials m
    join public.persons p on p.id = m.person_id
    where m.person_id = p_person and p.living_status = 'deceased'
  );
$$;

create function private.is_steward(p_person uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_memorial(p_person) and exists (
    select 1 from public.memorial_stewards s
    where s.person_id = p_person and s.user_id = (select auth.uid())
  );
$$;

create function private.can_write_story(p_person uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.persons p
    where p.id = p_person
      and not private.is_hidden_minor(p.id)
      and (private.can_edit_tree(p.tree_id)
           or p.claimed_by_user_id = (select auth.uid())
           or (private.is_memorial(p.id) and private.is_tree_member(p.tree_id)))
  );
$$;

-- Stewards also look after photos on a memorial profile.
create or replace function private.can_manage_media(p_media uuid)
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
           or private.is_tree_owner(m.tree_id)
           or private.is_steward(p.id))
  );
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;


-- -----------------------------------------------------------------------------
-- Rules
-- -----------------------------------------------------------------------------
create policy "Those who can see the person can see the memorial"
  on public.memorials for select to authenticated
  using (private.can_view_person(person_id));

create policy "Those who can see the person can see the stewards"
  on public.memorial_stewards for select to authenticated
  using (private.can_view_person(person_id));
-- Changes to memorials and stewards go through set_memorial() only.

create policy "Those who can see the person can read their stories"
  on public.stories for select to authenticated
  using (private.can_view_person(person_id) and not private.is_hidden_minor(person_id));

create policy "Family can write stories"
  on public.stories for insert to authenticated
  with check (
    private.can_write_story(person_id)
    and author = (select auth.uid())
    and tree_id = (select p.tree_id from public.persons p where p.id = person_id)
  );

create policy "Authors and stewards can edit stories"
  on public.stories for update to authenticated
  using (author = (select auth.uid()) or private.is_steward(person_id))
  with check (private.can_view_person(person_id));

create policy "Authors, the person, owners and stewards can delete stories"
  on public.stories for delete to authenticated
  using (
    author = (select auth.uid())
    or private.is_steward(person_id)
    or private.is_tree_owner(tree_id)
    or exists (select 1 from public.persons p
               where p.id = person_id and p.claimed_by_user_id = (select auth.uid()))
  );

-- A story stays with its person, tree and author.
create function private.story_fixed_columns()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.person_id <> old.person_id or new.tree_id <> old.tree_id
     or new.author is distinct from old.author then
    raise exception 'Only the title, text and language of a story can change'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger story_fixed_columns before update on public.stories
  for each row execute function private.story_fixed_columns();


-- -----------------------------------------------------------------------------
-- set_memorial: owners turn a memorial on or off and choose its stewards.
-- -----------------------------------------------------------------------------
create function public.set_memorial(p_person uuid, p_on boolean, p_stewards uuid[] default '{}')
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_tree   uuid;
  v_status public.living_status;
begin
  select p.tree_id, p.living_status into v_tree, v_status from public.persons p where p.id = p_person;
  if v_tree is null or not private.is_tree_owner(v_tree) then
    raise exception 'Only tree owners can set up a memorial'
      using errcode = 'insufficient_privilege', hint = 'memorial_not_allowed';
  end if;

  if not p_on then
    delete from public.memorials where person_id = p_person;
    return;
  end if;

  if v_status <> 'deceased' then
    raise exception 'Only for someone who has died' using errcode = 'P0001', hint = 'memorial_not_deceased';
  end if;
  if exists (select 1 from unnest(coalesce(p_stewards, '{}')) s(uid)
             where not exists (select 1 from public.tree_members m where m.tree_id = v_tree and m.user_id = s.uid)) then
    raise exception 'Stewards must be members of the tree' using errcode = 'P0001', hint = 'memorial_bad_steward';
  end if;
  if cardinality(coalesce(p_stewards, '{}')) > 5 then
    raise exception 'At most 5 stewards' using errcode = 'check_violation';
  end if;

  insert into public.memorials (person_id) values (p_person) on conflict (person_id) do nothing;
  delete from public.memorial_stewards where person_id = p_person;
  insert into public.memorial_stewards (person_id, user_id)
  select p_person, uid from unnest(coalesce(p_stewards, '{}')) uid
  on conflict do nothing;
end;
$$;

-- Tree members with the name of their own profile in the tree (for choosing
-- stewards). Owners only.
create function public.tree_member_names(p_tree uuid)
returns table (user_id uuid, role public.tree_role, name text)
language sql stable security definer set search_path = ''
as $$
  select m.user_id, m.role,
         (select n.full_display from public.persons p
          join public.person_names n on n.person_id = p.id and n.is_primary
          where p.tree_id = m.tree_id and p.claimed_by_user_id = m.user_id)
  from public.tree_members m
  where m.tree_id = p_tree and private.is_tree_owner(p_tree)
  order by m.role, m.created_at;
$$;

revoke all on function public.set_memorial(uuid, boolean, uuid[]) from public, anon;
grant execute on function public.set_memorial(uuid, boolean, uuid[]) to authenticated;
revoke all on function public.tree_member_names(uuid) from public, anon;
grant execute on function public.tree_member_names(uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- History: stories and memorials are logged like other family data.
-- -----------------------------------------------------------------------------
create or replace function private.log_pk(p_table text)
returns text
language sql immutable set search_path = ''
as $$
  select case p_table
    when 'event_dates' then 'event_id'
    when 'person_contacts' then 'person_id'
    when 'memorials' then 'person_id'
    else 'id'
  end;
$$;

create trigger stories_log_change after insert or update or delete on public.stories
  for each row execute function private.log_change();
create trigger memorials_log_change after insert or delete on public.memorials
  for each row execute function private.log_change();

-- Stories only show in History to those who may read them (as above).
