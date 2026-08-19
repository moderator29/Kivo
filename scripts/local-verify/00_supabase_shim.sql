-- =============================================================================
-- Supabase platform shim, for replaying KIVO's migrations onto a plain Postgres
-- =============================================================================
-- The migrations in supabase/migrations/ are written against a Supabase
-- project, which supplies a platform layer no stock Postgres has: the
-- anon/authenticated/service_role roles, the default grants those roles get on
-- `public`, the `auth` and `storage` schemas, and the pg_cron / pg_net
-- extensions.
--
-- This file creates just enough of that platform for the migration set to
-- replay verbatim. It is deliberately NOT a Supabase emulator: it exists so a
-- local database can answer "do these migrations actually apply from scratch,
-- and does the schema they produce behave", which nothing in this repository
-- had ever checked.
--
-- Every object below is a stand-in. Where a stand-in differs from the real
-- thing in a way that could mislead a test, it says so in a comment.
-- =============================================================================

-- 1. Roles. `authenticator` is the role PostgREST connects as and switches out
--    of; the other three are the roles RLS policies name.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin noinherit; end if;
end $$;

grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;

-- 2. The default grants migration 0001 explicitly says it assumes. Without
--    these, every RLS test passes for the wrong reason: the table-level GRANT
--    denies the query before a policy is ever evaluated.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- 3. auth. Only the surface the migrations touch: the users table profiles
--    references, and the three claim readers RLS calls.
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- Reads the same GUC PostgREST sets from the verified JWT, so `set local
-- request.jwt.claims` in a test session reproduces a real signed-in request
-- exactly as the policies see it.
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select nullif(auth.jwt() ->> 'role', '');
$$;

create or replace function auth.email() returns text
language sql stable as $$
  select nullif(auth.jwt() ->> 'email', '');
$$;

-- 4. storage. Two tables and one helper; the real service's other machinery
--    (uploads, transformations) is not modelled and is not what the migrations
--    touch. Policies land on these tables and can be read back, which is the
--    point.
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text,
  owner      uuid,
  created_at timestamptz not null default now(),
  metadata   jsonb
);

alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select string_to_array(name, '/');
$$;

grant all on storage.buckets, storage.objects to anon, authenticated, service_role;

-- 5. vault, for the two secrets the live-sync trigger reads.
create schema if not exists vault;
create table if not exists vault.decrypted_secrets (
  id             uuid primary key default gen_random_uuid(),
  name           text unique,
  decrypted_secret text
);
create or replace function vault.create_secret(p_secret text, p_name text default null)
returns uuid language sql as $$
  insert into vault.decrypted_secrets (name, decrypted_secret) values (p_name, p_secret)
  on conflict (name) do update set decrypted_secret = excluded.decrypted_secret
  returning id;
$$;

-- 6. The Realtime publication. Supabase creates this on every project; without
--    it, migration 0038's `alter publication supabase_realtime add table` fails
--    and the replay stops.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
