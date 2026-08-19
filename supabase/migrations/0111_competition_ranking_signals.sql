-- =============================================================================
-- 0111 — The two signals the matches list ranks competitions by
-- =============================================================================
-- THE PROBLEM
-- -----------
-- /matches and /live group fixtures under their competition, and the order of
-- those groups was "whichever kicked off first". On the live database that
-- puts "III Liga - Group 2" and "U19 Bundesliga" above the Champions League,
-- because the third division kicks off earlier in the day.
--
-- The founder asked for Europe's top five leagues first, then other major
-- competitions, then the rest. The tempting implementation is a list of league
-- names ranked by whoever is writing the code. That is an opinion compiled
-- into the product, it cannot be checked, and it goes stale silently.
--
-- So the ordering is derived from two signals that already exist as rows, and
-- this migration is the narrow read path for both. The derivation itself lives
-- in src/lib/football/competition-tier.ts and is documented there.
--
--   1. COVERAGE SCOPE. `provider_mappings` holds the active provider's own
--      league id for every competition KIVO has synced. KIVO already records,
--      in src/lib/football/competitions-config.ts, exactly which provider
--      league ids its pipeline is scoped to — an operator-configurable list
--      (`FOOTBALL_SYNC_COMPETITION_IDS`) whose shipped default is the five
--      European domestic leagues followed by the continental cups. A
--      competition the operator deliberately scoped the pipeline to outranks
--      one that merely turned up in a day's fixtures. That is a recorded
--      decision, not a ranking invented here.
--
--   2. FOLLOWERS. How many real KIVO profiles have followed the competition.
--      Emergent, checkable, and it is the same `follows` table the star on the
--      competition header writes to.
--
-- WHY BOTH NEED A FUNCTION
-- ------------------------
-- `provider_mappings` is admin-only by policy (0001) and `follows` is
-- select-your-own-rows-only (`follows_select_own`, 0001), so neither signal is
-- readable from a page render through RLS. Same shape of answer as
-- `get_most_followed_teams` (0040) and `get_prediction_consensus` (0032):
-- expose the one aggregate/lookup the UI needs through a narrow SECURITY
-- DEFINER function, never the table.
--
-- Both take the competition ids already on screen rather than scanning the
-- table, so the cost is bounded by what is being rendered.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Signal 1 — the active provider's league id, per competition
-- -----------------------------------------------------------------------------
-- Returns nothing but (competition, provider's own id for it). No user data is
-- reachable through it, and the ids themselves are the provider's public league
-- numbering — the same values that appear in API-Football's own documentation
-- and in competitions-config.ts in this repository. `provider_mappings` stays
-- admin-only; this is the one projection of it the public UI needs.
create or replace function public.get_competition_provider_ids(
  p_provider text,
  p_competition_ids uuid[]
)
returns table (
  competition_id uuid,
  provider_competition_id text
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select pm.kivo_entity_id, pm.provider_entity_id
  from provider_mappings pm
  where pm.entity_type = 'competition'
    and pm.provider = p_provider
    and pm.kivo_entity_id = any(coalesce(p_competition_ids, '{}'::uuid[]))
$$;

revoke execute on function public.get_competition_provider_ids(text, uuid[]) from public;
-- anon as well as authenticated: /matches renders for a signed-out visitor and
-- must order its groups the same way it does for a member.
grant execute on function public.get_competition_provider_ids(text, uuid[]) to anon, authenticated;

comment on function public.get_competition_provider_ids(text, uuid[]) is
  'The active provider''s own league id for each of the given competitions, read from provider_mappings (which is admin-only by policy). Returns no user data. Used by the matches list to rank a competition against KIVO''s configured coverage scope.';


-- -----------------------------------------------------------------------------
-- Signal 2 — how many KIVO profiles follow each competition
-- -----------------------------------------------------------------------------
-- A count and nothing else, exactly like get_most_followed_teams (0040): never
-- who follows whom. A competition nobody follows returns no row rather than a
-- zero, so the caller can tell "no follows" from "not asked about".
create or replace function public.get_competition_follower_counts(
  p_competition_ids uuid[]
)
returns table (
  competition_id uuid,
  follower_count bigint
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select f.followed_id, count(*)::bigint
  from follows f
  where f.followed_type = 'competition'
    and f.followed_id = any(coalesce(p_competition_ids, '{}'::uuid[]))
  group by f.followed_id
$$;

revoke execute on function public.get_competition_follower_counts(uuid[]) from public;
grant execute on function public.get_competition_follower_counts(uuid[]) to anon, authenticated;

comment on function public.get_competition_follower_counts(uuid[]) is
  'How many profiles follow each of the given competitions. Aggregate only — never who follows whom — because follows_select_own (0001) restricts a direct read to the caller''s own rows. Same pattern as get_most_followed_teams (0040).';


-- To reverse:
--   drop function if exists public.get_competition_provider_ids(text, uuid[]);
--   drop function if exists public.get_competition_follower_counts(uuid[]);
