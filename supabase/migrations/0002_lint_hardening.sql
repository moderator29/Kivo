-- Pin search_path on the two functions the Supabase linter flagged as mutable.
alter function set_updated_at() set search_path = public, pg_temp;
alter function private.current_clerk_user_id() set search_path = public, pg_temp;

-- citext shouldn't live in public — relocate it to the extensions schema
-- Supabase reserves for exactly this (profiles.username's type survives the move).
create schema if not exists extensions;
alter extension citext set schema extensions;

-- To reverse: alter extension citext set schema public (only if nothing else
-- has since moved into the extensions schema expecting citext there); the
-- search_path pins on set_updated_at()/current_clerk_user_id() are safe to
-- leave in place even on rollback, or clear with `alter function ... reset
-- search_path`.
