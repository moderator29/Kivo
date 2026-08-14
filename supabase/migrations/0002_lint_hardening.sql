-- Pin search_path on the two functions the Supabase linter flagged as mutable.
alter function set_updated_at() set search_path = public, pg_temp;
alter function private.current_clerk_user_id() set search_path = public, pg_temp;

-- citext shouldn't live in public — relocate it to the extensions schema
-- Supabase reserves for exactly this (profiles.username's type survives the move).
create schema if not exists extensions;
alter extension citext set schema extensions;
