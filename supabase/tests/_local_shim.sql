-- ============================================================
-- UniVerse — Supabase shim for plain Postgres
--
-- Supabase gives you three roles, an auth schema and auth.uid().
-- Plain Postgres doesn't, so this stands in for them when you want
-- to run the migrations and tests locally without Supabase:
--
--   initdb -D ./pgdata -A trust
--   pg_ctl -D ./pgdata -o "-p 5440 -k $PWD/pgsock" -l pg.log start
--   export PGHOST=$PWD/pgsock PGPORT=5440 PGUSER=postgres
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/_local_shim.sql
--   for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -f $f; done
--   psql -v ON_ERROR_STOP=1 -f supabase/seed.sql
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/0005_organisers_test.sql
--
-- Never run this against your real Supabase project.
-- Safe to re-run.
-- ============================================================

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role')  then create role service_role nologin; end if;
end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);

-- Supabase reads the signed JWT; here we just read a session setting,
-- so a test can "become" a student with set_config(...).
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Supabase grants these; without them every RLS policy that calls
-- auth.uid() fails with "permission denied for schema auth", which
-- looks exactly like a policy rejection and will fool a test.
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant select on auth.users to service_role;
