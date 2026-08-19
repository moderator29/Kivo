-- =============================================================================
-- fantasy_rosters: no user-facing write policies at all
-- =============================================================================
-- APPLIED to the live project (gkyjfihxxdynfwqhhpyn) on 2026-08-19 by the
-- security-sweep agent, immediately after content-verifying commit 9603245 on
-- origin/claude/kivo-master-build-2qijfs. Finding F2 in docs/SECURITY_REVIEW.md.
--
-- SEQUENCING MATTERED HERE, so it is recorded rather than implied. This
-- migration removes every way an ordinary user's session can write
-- `fantasy_rosters`. Applying it before `setGameweekRoster` and
-- `setFantasyCaptain` were writing as service_role would have locked every
-- manager out of their own squad. So the order was, and must be if this is ever
-- replayed against a live database:
--
--   1. the actions start writing through `rosterWriter()` (service_role)   ← commit 9603245
--   2. this migration drops the user write policies                        ← here
--
-- Verified before applying, off origin rather than from a claim: `rosterWriter`
-- appears 4x in `(app)/fantasy/actions.ts`, `createServiceRoleSupabaseClient()`
-- 2x in `src/lib/fantasy.ts`, `getOrCreateProfile()` 8x in the actions file.
--
-- -----------------------------------------------------------------------------
-- WHY NOT A TIGHTER POLICY, WHICH IS WHAT 0095 TRIED
-- -----------------------------------------------------------------------------
-- 0095 added a deadline predicate to these policies. That closed "edit after
-- kickoff" completely and it could not close "field an illegal squad before
-- kickoff", because budget, squad size, formation and the per-club cap are all
-- properties of the fifteen-row SET being written, and a per-row `WITH CHECK`
-- cannot see the set. A user could still PATCH directly before the deadline and
-- field sixteen players, or fifteen strikers, or £300 of squad.
--
-- Three options existed. Duplicating the squad rules into a SECURITY DEFINER
-- SQL function was rejected: two authoritative copies of the rules in two
-- languages fails as a squad the UI accepts and the database rejects, or the
-- reverse, and nobody can tell which is correct. Keeping the partial predicate
-- was rejected as the worst of the three — it looks like data-layer enforcement
-- while leaving the set-level rules wide open, which is the version that stops
-- people checking.
--
-- So: the complete answer. The server action becomes the only writer, and it is
-- the only place the squad rules live.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS COSTS, AND WHAT BUYS IT BACK
-- -----------------------------------------------------------------------------
-- The database no longer backstops ownership: a bug in the action writing to
-- somebody else's team would no longer be refused down here. That is a narrower
-- risk than the one it closes, and unlike the squad rules it is *testable* —
-- the action derives `profile` from the session via `getOrCreateProfile()`,
-- never from an argument, and compares it against `owner_profile_id` read fresh
-- from the database, so a caller can influence neither side of the comparison.
--
-- `src/lib/server-action-identity.test.ts` asserts exactly that, across every
-- service-role writer rather than just this one, and covers
-- `carryForwardFantasyRoster` specifically — the one place the invariant lives
-- outside a server action, and therefore the one most likely to rot.
--
-- -----------------------------------------------------------------------------
-- WHAT STAYS, AND WHY IT IS NOT A FORMALITY
-- -----------------------------------------------------------------------------
-- `fantasy_rosters_select_own` is deliberately untouched. Only the mutating
-- statements were elevated; every read in the fantasy surface still goes
-- through the user's RLS-gated client, so that policy is doing real work on
-- every page load. Narrowing the elevation to exactly the statements that need
-- it is what makes this a considered exception rather than a habit — dropping
-- the select policy too would quietly undo that.
--
-- With RLS enabled and no INSERT/UPDATE/DELETE policy, Postgres denies those
-- statements by default for `authenticated` and `anon`, regardless of the
-- blanket table grants Supabase issues. Same shape as `prediction_league_members`
-- (0075), which has never had an INSERT policy and is written only by
-- `redeem_prediction_invite_code`.

drop policy if exists fantasy_rosters_insert_own_before_deadline on fantasy_rosters;
drop policy if exists fantasy_rosters_update_own_before_deadline on fantasy_rosters;
drop policy if exists fantasy_rosters_delete_own_before_deadline on fantasy_rosters;

-- Deliberately NOT dropped:
--   fantasy_rosters_select_own  (0095) — reads stay RLS-gated and ownership-scoped.

comment on table fantasy_rosters is
  'Squad rows per (team, gameweek). WRITES ARE SERVER-ONLY BY DESIGN: there is no user-facing INSERT/UPDATE/DELETE policy, because squad size, budget, formation and the per-club cap are properties of the whole 15-row set and a per-row WITH CHECK cannot evaluate them. setGameweekRoster / setFantasyCaptain / carryForwardFantasyRoster write as service_role and own those rules. Reads remain RLS-gated via fantasy_rosters_select_own. See 0097 and docs/SECURITY_REVIEW.md F2.';

-- To reverse (only alongside reverting the actions to the session client, or
-- every manager loses the ability to save a squad):
--   recreate the three *_before_deadline policies exactly as 0095 defined them.
