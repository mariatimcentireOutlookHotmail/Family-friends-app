-- =============================================================================
-- Trees, tree members, persons and person names, with Row-Level Security.
--
-- Privacy rules (enforced here, in the database, not only in the app):
--   * Signed-out visitors (anon) can't read or write anything.
--   * A tree and everything in it is visible only to that tree's members.
--   * viewer: read.  editor: also add and edit people.  owner: also manage
--     members, rename and delete.
--   * Once a person is claimed, only the person who claimed it can edit its
--     details and names (not even the tree owner).
--   * Only owners change roles; a tree always keeps at least one owner.
--
-- Tests for every rule: tests/db/rls.test.ts (npm test).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Types
-- -----------------------------------------------------------------------------
create type public.tree_role as enum ('owner', 'editor', 'viewer');
create type public.living_status as enum ('living', 'deceased', 'unknown');
create type public.sex as enum ('female', 'male', 'other', 'unknown');
create type public.name_type as enum ('birth', 'married', 'nickname', 'religious', 'other');


-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

-- One family's tree. Each family has its own; trees can be linked later.
create table public.trees (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(name) between 1 and 200),
  default_locale text not null default 'en' check (default_locale in ('en', 'id', 'zh-Hans')),
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);

-- Who can see and edit a tree.
create table public.tree_members (
  tree_id    uuid not null references public.trees (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.tree_role not null,
  created_at timestamptz not null default now(),
  primary key (tree_id, user_id)
);
create index tree_members_user_id_idx on public.tree_members (user_id);

-- A person in a tree. A "shadow profile" until someone claims it.
-- People are separate from login accounts, so anyone can be added before
-- they sign up.
create table public.persons (
  id                 uuid primary key default gen_random_uuid(),
  tree_id            uuid not null references public.trees (id) on delete cascade,
  claimed_by_user_id uuid references auth.users (id) on delete set null,
  sex                public.sex not null default 'unknown',
  living_status      public.living_status not null default 'unknown',
  -- 1 = eldest. Needed for kinship words that depend on elder vs younger.
  birth_order        smallint check (birth_order >= 1),
  created_by         uuid default auth.uid() references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- A user can claim at most one person per tree.
  unique (tree_id, claimed_by_user_id)
);
create index persons_tree_id_idx on public.persons (tree_id);
create index persons_claimed_by_idx on public.persons (claimed_by_user_id);

-- Several names per person (e.g. a Chinese name and a romanized one, or a
-- birth and a married name). Never assume "first + last".
create table public.person_names (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references public.persons (id) on delete cascade,
  type         public.name_type not null default 'birth',
  given        text,
  family       text,
  patronymic   text,
  prefix       text,
  suffix       text,
  -- The name as it should be shown, already in the name's own order
  -- (e.g. family name first for Chinese).
  full_display text not null check (char_length(full_display) between 1 and 300),
  -- ISO 15924 script code, e.g. 'Latn', 'Hans', 'Hant', 'Cyrl', 'Arab'.
  script       text check (script ~ '^[A-Z][a-z]{3}$'),
  -- BCP 47 language tag of the name, e.g. 'zh', 'id', 'en'.
  lang         text check (char_length(lang) between 2 and 35),
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index person_names_person_id_idx on public.person_names (person_id);
-- At most one primary name per person.
create unique index person_names_one_primary_idx
  on public.person_names (person_id) where is_primary;


-- -----------------------------------------------------------------------------
-- Helper functions for the policies
--
-- They live in a "private" schema so they aren't exposed through the API, and
-- run as "security definer" so a policy on tree_members can check
-- tree_members without looping into itself.
-- -----------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- The signed-in user's role in a tree, or null if they're not a member.
create function private.tree_role(p_tree_id uuid)
returns public.tree_role
language sql stable security definer set search_path = ''
as $$
  select m.role
  from public.tree_members m
  where m.tree_id = p_tree_id and m.user_id = (select auth.uid());
$$;

create function private.is_tree_member(p_tree_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.tree_role(p_tree_id) is not null;
$$;

create function private.can_edit_tree(p_tree_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.tree_role(p_tree_id) in ('owner', 'editor'), false);
$$;

create function private.is_tree_owner(p_tree_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.tree_role(p_tree_id) = 'owner', false);
$$;

create function private.can_view_person(p_person_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.persons p
    where p.id = p_person_id and private.is_tree_member(p.tree_id)
  );
$$;

-- Claimed: only the claimant. Unclaimed: the tree's owners and editors.
create function private.can_edit_person(p_person_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.persons p
    where p.id = p_person_id
      and case
        when p.claimed_by_user_id is not null
          then p.claimed_by_user_id = (select auth.uid())
        else private.can_edit_tree(p.tree_id)
      end
  );
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;


-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

-- Whoever creates a tree becomes its owner.
create function private.add_tree_creator_as_owner()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.created_by is not null then
    insert into public.tree_members (tree_id, user_id, role)
    values (new.id, new.created_by, 'owner');
  end if;
  return new;
end;
$$;

create trigger trees_add_owner
after insert on public.trees
for each row execute function private.add_tree_creator_as_owner();

-- A tree must always keep at least one owner. (Skipped when the whole tree is
-- being deleted, because then its members are removed too.)
create function private.keep_one_owner()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and exists (select 1 from public.trees t where t.id = old.tree_id)
     and not exists (
       select 1 from public.tree_members m
       where m.tree_id = old.tree_id and m.role = 'owner' and m.user_id <> old.user_id
     )
  then
    raise exception 'A tree must keep at least one owner'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger tree_members_keep_one_owner
before update or delete on public.tree_members
for each row execute function private.keep_one_owner();

-- Moving a person to another tree is never allowed. Setting or changing who
-- claimed a person is reserved for trusted server code (the invite flow in a
-- later phase), not for app users.
create function private.protect_person_fields()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.tree_id <> old.tree_id then
    raise exception 'A person cannot be moved to another tree'
      using errcode = 'check_violation';
  end if;
  if new.claimed_by_user_id is distinct from old.claimed_by_user_id
     and current_user in ('anon', 'authenticated')
  then
    raise exception 'claimed_by_user_id can only be changed by the invite flow'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger persons_protect_fields
before update on public.persons
for each row execute function private.protect_person_fields();

-- A name can't be moved to a different person.
create function private.protect_name_person()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.person_id <> old.person_id then
    raise exception 'A name cannot be moved to another person'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger person_names_protect_person
before update on public.person_names
for each row execute function private.protect_name_person();

create function private.set_updated_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger persons_set_updated_at
before update on public.persons
for each row execute function private.set_updated_at();

create trigger person_names_set_updated_at
before update on public.person_names
for each row execute function private.set_updated_at();


-- -----------------------------------------------------------------------------
-- Table access
--
-- Signed-out visitors get nothing. Signed-in users get table access, which the
-- policies below then narrow down row by row.
-- -----------------------------------------------------------------------------
revoke all on public.trees, public.tree_members, public.persons, public.person_names from anon;
grant select, insert, update, delete
  on public.trees, public.tree_members, public.persons, public.person_names
  to authenticated;


-- -----------------------------------------------------------------------------
-- Row-Level Security policies
-- -----------------------------------------------------------------------------
alter table public.trees        enable row level security;
alter table public.tree_members enable row level security;
alter table public.persons      enable row level security;
alter table public.person_names enable row level security;

-- trees ------------------------------------------------------------------------
-- The creator can also see the row, so "insert ... returning" works the moment
-- a tree is created.
create policy "Members can view their trees"
  on public.trees for select to authenticated
  using (private.is_tree_member(id) or created_by = (select auth.uid()));

create policy "Signed-in users can create trees they own"
  on public.trees for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy "Owners can update their trees"
  on public.trees for update to authenticated
  using (private.is_tree_owner(id))
  with check (private.is_tree_owner(id));

create policy "Owners can delete their trees"
  on public.trees for delete to authenticated
  using (private.is_tree_owner(id));

-- tree_members -----------------------------------------------------------------
create policy "Members can view the members of their trees"
  on public.tree_members for select to authenticated
  using (private.is_tree_member(tree_id));

create policy "Owners can add members"
  on public.tree_members for insert to authenticated
  with check (private.is_tree_owner(tree_id));

create policy "Owners can change roles"
  on public.tree_members for update to authenticated
  using (private.is_tree_owner(tree_id))
  with check (private.is_tree_owner(tree_id));

create policy "Owners can remove members, and anyone can leave"
  on public.tree_members for delete to authenticated
  using (private.is_tree_owner(tree_id) or user_id = (select auth.uid()));

-- persons ----------------------------------------------------------------------
create policy "Members can view people in their trees"
  on public.persons for select to authenticated
  using (private.is_tree_member(tree_id));

-- New people start unclaimed; claiming happens through the invite flow.
create policy "Owners and editors can add people"
  on public.persons for insert to authenticated
  with check (private.can_edit_tree(tree_id) and claimed_by_user_id is null);

create policy "Editors edit unclaimed people; claimants edit themselves"
  on public.persons for update to authenticated
  using (
    case when claimed_by_user_id is not null
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

create policy "Owners can delete unclaimed people"
  on public.persons for delete to authenticated
  using (private.is_tree_owner(tree_id) and claimed_by_user_id is null);

-- person_names -----------------------------------------------------------------
create policy "Members can view names of people in their trees"
  on public.person_names for select to authenticated
  using (private.can_view_person(person_id));

create policy "Those who can edit a person can add names"
  on public.person_names for insert to authenticated
  with check (private.can_edit_person(person_id));

create policy "Those who can edit a person can change names"
  on public.person_names for update to authenticated
  using (private.can_edit_person(person_id))
  with check (private.can_edit_person(person_id));

create policy "Those who can edit a person can delete names"
  on public.person_names for delete to authenticated
  using (private.can_edit_person(person_id));
