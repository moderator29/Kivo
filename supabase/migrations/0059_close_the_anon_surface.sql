-- =============================================================================
-- 0059 — Close the anon surface, and stop it growing back
-- =============================================================================
-- KIVO_NEXT_GEN.md KN-120 (the audit) and KN-27 (the recurrence).
--
-- WHY NOW
-- -------
-- On 2026-08-18 KIVO moved to Supabase Auth and gated the entire `(app)` route
-- group with no guest preview (`src/app/(app)/layout.tsx`). The database was
-- not part of that change and still describes the product that existed before
-- it: nineteen `to anon` SELECT policies and thirteen public RPCs granted to
-- `anon`, all built for a guest-browsable app.
--
-- This is not tidying. The `anon` key is published in the browser bundle — it
-- is meant to be public, and its safety comes entirely from what the `anon`
-- ROLE is allowed to do. Right now that role can read, over PostgREST, with no
-- account and no sign-in:
--
--   * every fixture, team, player, competition, standing, lineup, transfer,
--     manager, venue and match statistic KIVO has, and
--   * `posts`, `comments`, `reactions` and `poll_options` — the entire social
--     layer, which is user-generated content the product decided hours ago is
--     behind a login.
--
-- The second bullet is the one that matters. Gating the app made a promise to
-- users about who can see what they write; leaving these policies in place
-- means that promise holds only in the UI. Anyone with the publishable key —
-- which is everybody — can still read the feed.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
-- It does not touch `storage.objects`' `avatars_select_public`. Avatars are
-- served as plain image URLs to `<img>` tags and are genuinely public assets;
-- revoking that would break every avatar for signed-in users too.
--
-- IT IS DELIBERATELY REVERSIBLE, AND HOW
-- --------------------------------------
-- KN-119 leaves open whether KIVO should later carve out a read-only public
-- preview of `/matches/[id]` and the entity pages (see DECISIONS.md). If that
-- call is made, the reversal for the football-reference half is written out at
-- the bottom of this file. The social half (`posts`, `comments`, `reactions`,
-- `poll_options`) should NOT be reversed with it — a public preview of match
-- data is a growth decision; a public feed is a privacy one, and they are not
-- the same question.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The nineteen `to anon` SELECT policies become `to authenticated`
-- -----------------------------------------------------------------------------
-- Each is recreated with the identical USING expression it already had; the
-- only change in every one is dropping `anon` from the role list.
--
-- Driven off pg_policies rather than typed out, deliberately: several of these
-- USING clauses are not `true`. `posts_select_public` and
-- `comments_select_public` carry 0045's moderation visibility logic, and
-- re-typing that by hand — twice, in a migration whose whole purpose is
-- tightening access — is exactly how a policy gets quietly widened. Reading the
-- expression back out of the catalogue makes "identical except for the role"
-- true by construction. The count assertion below is what keeps that honest: if
-- the set is ever not the nineteen this was written against, the migration
-- fails rather than silently converting more or fewer tables than intended.

do $$
declare
  r record;
  v_using text;
  v_count int := 0;
begin
  for r in
    select tablename, policyname, qual
    from pg_policies
    where schemaname = 'public'
      and cmd = 'SELECT'
      and 'anon' = any(roles)
      and policyname like '%\_select\_public' escape '\'
  loop
    v_using := coalesce(r.qual, 'true');
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    execute format(
      'create policy %I on public.%I for select to authenticated using (%s)',
      r.policyname, r.tablename, v_using
    );
    v_count := v_count + 1;
  end loop;

  if v_count <> 19 then
    raise exception
      'Expected 19 anon SELECT policies to convert, found %. The anon surface has changed since this migration was written - re-audit before applying.',
      v_count;
  end if;

  -- And the assertion that actually matters: nothing anon-readable is left.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and 'anon' = any(roles)
  ) then
    raise exception 'A `to anon` policy on a public table survived this migration.';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. Public RPCs: revoke EXECUTE from anon
-- -----------------------------------------------------------------------------
-- Every one of these is called from a page inside the gated app group, so none
-- of them has an anonymous caller left. `get_public_profiles` and friends are
-- named "public" in the sense of "non-sensitive columns of another user's
-- profile", not in the sense of "reachable without an account".

revoke execute on function public.get_public_profiles(uuid[]) from anon;
revoke execute on function public.get_public_profile_by_username(text) from anon;
revoke execute on function public.get_public_profile_stats(uuid) from anon;
revoke execute on function public.get_predictions_leaderboard(int) from anon;
revoke execute on function public.is_username_available(text, uuid) from anon;
revoke execute on function public.get_prediction_consensus(uuid[]) from anon;
revoke execute on function public.get_fan_rating_summary(uuid) from anon;
revoke execute on function public.get_poll_results(uuid) from anon;
revoke execute on function public.get_most_followed_teams(int) from anon;
revoke execute on function public.get_fantasy_ownership(uuid, uuid) from anon;

-- `set_updated_at` is a trigger function and was never meant to be callable by
-- anybody. It is anon-executable purely because of the default privileges this
-- migration fixes in section 4. (Trigger functions do not need EXECUTE at fire
-- time — Postgres checks that when the trigger is created — so revoking it
-- cannot break the triggers that use it.)
revoke execute on function public.set_updated_at() from anon;

-- `get_match_room_activity` shipped hours before this migration and was already
-- anon-callable on arrival, without anyone granting it. That is section 4's
-- point, restated with a live example: this is the THIRD occurrence, after
-- `prune_sync_runs` (0025) and `get_my_followers` (0050).
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_match_room_activity'
  ) then
    execute 'revoke execute on function public.get_match_room_activity(uuid[]) from anon';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 3. The `private` schema
-- -----------------------------------------------------------------------------
-- 0001 did `grant usage on schema private to authenticated, anon` and
-- `grant execute on all functions in schema private to authenticated, anon`.
-- Those helpers exist to resolve the CALLER's identity, moderation status and
-- role. For an anonymous caller every one of them returns null or false by
-- construction, so anon never needed them — it was granted them because the
-- `to anon` policies in section 1 referenced them, and those are gone now.
--
-- Revoking USAGE on the schema is the load-bearing half. Function-level EXECUTE
-- in `private` also reaches anon via Postgres's built-in default of granting
-- EXECUTE to PUBLIC (there is no explicit default ACL on this schema, unlike
-- `public`), so revoking from `anon` alone would leave it reachable through
-- PUBLIC. Without schema USAGE, nothing in `private` is callable at all.

revoke execute on all functions in schema private from anon;
revoke usage on schema private from anon;


-- -----------------------------------------------------------------------------
-- 4. Stop the surface growing back (KN-27)
-- -----------------------------------------------------------------------------
-- This project's default privileges grant EXECUTE on every newly created
-- public-schema function to `anon`. It has bitten this codebase three times:
--
--   * `prune_sync_runs` shipped anon-callable — an unauthenticated caller could
--     delete `sync_runs` rows (fixed in 0025, after `get_advisors` found it).
--   * `get_my_followers` shipped anon-callable twenty-five migrations later
--     (fixed in 0050, found the same way).
--   * `get_match_room_activity` shipped anon-callable earlier today, and is
--     revoked in section 2 above.
--
-- All three were caught after the fact, by an advisor, by someone who thought
-- to look. Nothing in the schema prevented the next one. This does: from here
-- a new `public` function is NOT anon-callable unless a migration says so in
-- writing, which is the right default for a product with no anonymous surface.
--
-- Scope, stated precisely so this is not mistaken for more than it is: default
-- privileges are per-(grantor, schema), and this one is recorded for the role
-- running the migration. Migrations run as `postgres`, which is what creates
-- every function in `supabase/migrations/`, so it covers everything this
-- repository will ever add. A function created by a different role — e.g. via
-- the Supabase dashboard's SQL editor under another login — is not covered.

alter default privileges in schema public revoke execute on functions from anon;

-- Same for the private schema, for completeness. Note this one is belt over
-- braces: section 3 already removed anon's USAGE on the schema, which is the
-- real gate.
alter default privileges in schema private revoke execute on functions from anon;


-- =============================================================================
-- To reverse
-- =============================================================================
-- If the KN-119 public-preview decision is later made in favour (see
-- DECISIONS.md, "Gating the app"), reverse ONLY the football-reference half:
--
--   create policy <t>_select_public on public.<t> for select to authenticated, anon using (true);
--
-- for competitions, seasons, teams, players, managers, venues, fixtures,
-- fixture_events, fixture_statistics, lineups, standings, transfers,
-- fantasy_gameweeks, fantasy_player_prices and badges — and re-grant
-- get_most_followed_teams / get_fan_rating_summary if the preview shows them.
--
-- Do NOT reverse posts, comments, reactions or poll_options along with it, and
-- do not reverse section 4. A public preview of match data is a growth
-- decision; a world-readable social feed is a privacy one.
