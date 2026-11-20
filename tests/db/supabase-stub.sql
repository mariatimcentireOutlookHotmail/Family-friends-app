-- A minimal stand-in for what every Supabase database already has, so the
-- migrations can run in PGlite (an in-memory Postgres) for tests.
-- TEST-ONLY: never put this in supabase/migrations.

-- Roles Supabase uses for API requests.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

-- Supabase Auth's user table (only the columns we need).
create schema auth;
create table auth.users (
  id    uuid primary key,
  email text
);

-- Same behaviour as Supabase's auth.uid(): the signed-in user's id, taken from
-- the request's JWT claims, or null when signed out.
create function auth.uid()
returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase's defaults: the API roles can use the public schema, and new tables
-- are granted to them. Row-Level Security is what actually protects the data,
-- which is exactly what the tests check.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
