-- =============================================================================
-- Profiles: each account's own settings (for now, the app language).
--
-- Privacy rules:
--   * A profile is created automatically when someone signs up.
--   * Each user can see and change only their own profile.
--   * Users can't create or delete profiles directly; deleting the account
--     deletes the profile.
--
-- Tests: tests/db/profiles.test.ts
-- =============================================================================

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  -- App language. null = follow the device language.
  locale     text check (locale in ('en', 'id', 'zh-Hans')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Create a profile for every new account.
create function private.create_profile_for_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_create_profile
after insert on auth.users
for each row execute function private.create_profile_for_new_user();

-- Accounts that already exist (e.g. created while testing) get one too.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

-- The id can never change.
create function private.protect_profile_id()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.id <> old.id then
    raise exception 'A profile id cannot change' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_id
before update on public.profiles
for each row execute function private.protect_profile_id();

-- Table access: signed-in users may only read and update (rows are then
-- limited to their own by the policies below).
revoke all on public.profiles from anon, authenticated;
grant select, update on public.profiles to authenticated;

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
