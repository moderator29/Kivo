-- =============================================================================
-- Restore the grants that recreating upsert_fixture_with_mapping silently lost
-- =============================================================================
-- Found by running `get_advisors` after migration 0072, which is the only
-- reason it was found at all — nothing else would have surfaced it, and it is
-- worth writing down as a pattern rather than just fixing.
--
-- 0072 dropped the 14-argument `upsert_fixture_with_mapping` and created a
-- 15-argument one (KN-84's `p_matchday`). A newly created function does not
-- inherit the previous function's grants — and this project's default
-- privileges explicitly grant EXECUTE on new public-schema functions to `anon`
-- (the finding migration 0025 exists to document). So the new function came
-- into the world callable, unauthenticated, over
-- `/rest/v1/rpc/upsert_fixture_with_mapping`.
--
-- That is a real hole, not a lint nit: the function is SECURITY DEFINER and
-- writes `fixtures` and `provider_mappings`, so an anonymous caller could have
-- inserted football data. It existed for roughly twenty minutes between 0072
-- applying and this migration.
--
-- The general rule, for anyone changing a function's signature later: dropping
-- and recreating a function resets its grants. Re-state them in the same
-- migration, and run `get_advisors` afterwards.

revoke execute on function public.upsert_fixture_with_mapping(
  text, text, uuid, uuid, uuid, uuid, fixture_status, timestamptz,
  uuid, smallint, smallint, smallint, smallint, smallint, smallint
) from public, anon, authenticated;

grant execute on function public.upsert_fixture_with_mapping(
  text, text, uuid, uuid, uuid, uuid, fixture_status, timestamptz,
  uuid, smallint, smallint, smallint, smallint, smallint, smallint
) to service_role;

-- NOT FIXED HERE, and deliberately: `get_advisors` also reports `pg_net` as
-- installed in the `public` schema (migration 0067). `alter extension pg_net
-- set schema extensions` fails outright — pg_net does not support SET SCHEMA —
-- so moving it means dropping and recreating the extension, which would
-- destroy the request queue and response history of anything in flight. The
-- honest position is that this stays as a known INFO/WARN-level advisory with
-- a stated reason, rather than being papered over: pg_net's own functions live
-- in the `net` schema and are not exposed through PostgREST, so the practical
-- exposure is the extension's presence in `public`, not a callable surface.
