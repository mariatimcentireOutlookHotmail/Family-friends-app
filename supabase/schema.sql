-- Run in the Supabase SQL editor for a new project.
create table public.people (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  user_id uuid unique references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now(),
  constraint own_profile check (user_id is null or user_id = owner_id)
);

create table public.relationships (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  related_person_id uuid not null references public.people(id) on delete cascade,
  kind text not null check (kind in ('parent', 'spouse', 'child', 'friend')),
  created_at timestamptz not null default now(),
  constraint different_people check (person_id <> related_person_id),
  unique (person_id, related_person_id, kind)
);

alter table public.people enable row level security;
alter table public.relationships enable row level security;

create policy "Users can read their people" on public.people
  for select to authenticated using (owner_id = auth.uid());
create policy "Users can create their people" on public.people
  for insert to authenticated with check (owner_id = auth.uid());
create policy "Users can read their relationships" on public.relationships
  for select to authenticated using (owner_id = auth.uid());
create policy "Users can create their relationships" on public.relationships
  for insert to authenticated with check (
    owner_id = auth.uid()
    and exists (select 1 from public.people where id = person_id and owner_id = auth.uid() and user_id = auth.uid())
    and exists (select 1 from public.people where id = related_person_id and owner_id = auth.uid() and user_id is null)
  );

-- A failed relationship insert rolls back creation of the shadow profile.
create function public.add_connection(connection_name text, connection_kind text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  self_id uuid;
  connection_id uuid;
begin
  select id into strict self_id from public.people where user_id = auth.uid();
  insert into public.people (name) values (trim(connection_name)) returning id into connection_id;
  insert into public.relationships (person_id, related_person_id, kind)
    values (self_id, connection_id, connection_kind);
end;
$$;
revoke all on function public.add_connection(text, text) from public;
grant execute on function public.add_connection(text, text) to authenticated;
