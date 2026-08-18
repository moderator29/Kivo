-- =============================================================================
-- KIVO RLS verification script  (RECOMMENDATIONS.md #208)
-- =============================================================================
--
-- WHAT THIS IS
-- ------------
-- A real integration check of Postgres RLS policy evaluation against the
-- live/connected Supabase project (see supabase/migrations/0001_kivo_core_schema.sql
-- for the policies under test). It does NOT mock the Supabase client — every
-- assertion below is a genuine SQL statement evaluated by Postgres with RLS
-- enabled, using the exact same policies the running app relies on.
--
-- WHY THIS APPROACH INSTEAD OF A VITEST FILE HITTING POSTGREST
-- --------------------------------------------------------------
-- KIVO uses Supabase's native third-party auth: RLS policies read the caller's
-- identity from `auth.jwt() ->> 'sub'` (see private.current_clerk_user_id() in
-- the migration), and that JWT is a *Clerk*-issued token verified against
-- Clerk's JWKS by Supabase's API gateway. There is no service that will hand a
-- test script a real, validly-signed Clerk JWT for a synthetic user without
-- driving an actual Clerk sign-in flow (which this repo does not have headless
-- credentials for), so a Vitest test using the anon key cannot authenticate as
-- a *specific* user and therefore cannot exercise cross-user isolation over
-- PostgREST. (A companion Vitest file,
-- src/lib/supabase/rls-anon.integration.test.ts, DOES exercise real anon-role
-- PostgREST traffic for what's actually reachable that way: public-read
-- tables and the "anon can't read/write owner-scoped tables" boundary. See
-- that file for why it self-skips when the live project isn't reachable.)
--
-- What this script does instead is exercise the *identical* Postgres
-- mechanism from the server side, using the same session variable PostgREST
-- itself sets after verifying a JWT:
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<clerk_user_id>","role":"authenticated"}';
--
-- private.current_clerk_user_id() reads exactly this via
-- `auth.jwt() ->> 'sub'` (confirmed live: auth.jwt() is
-- `coalesce(current_setting('request.jwt.claim', true),
-- current_setting('request.jwt.claims', true))::jsonb`). Setting it this way
-- is not a shortcut around RLS — it is precisely the input RLS policies
-- consume; the only thing this script doesn't reproduce is JWKS signature
-- verification itself, which is Supabase Auth's job, not RLS's. Every
-- assertion below runs through the real policy USING/WITH CHECK expressions
-- against real rows in the real database.
--
-- Run via the Supabase MCP `execute_sql` tool (project: gkyjfihxxdynfwqhhpyn)
-- or `psql "$DATABASE_URL" -f scripts/verify-rls.sql` with a role that can
-- `set role authenticated` (the project owner/postgres role can; this is
-- intentionally NOT run with the service_role key from any committed code).
--
-- TEST DATA / CLEANUP
-- --------------------
-- Two synthetic profiles ("zzrlstest_alice" / "zzrlstest_bob") plus minimal
-- supporting rows (competition/season/teams/fixture/player/fantasy league)
-- are inserted under the `zzrlstest_` / "ZZ RLS Test ..." prefix so they are
-- unambiguously test data. Section 1 also seeds five more profiles for
-- section 6i's moderation_status checks (item 234): an admin, plus one
-- profile per non-default state (suspended, banned, shadow_muted, and a
-- suspended-with-already-elapsed-expiry to exercise lazy revert). Section 6j
-- (this task's own build: items 1/2/4, migration
-- 0047_match_room_system_posts) reuses carol/erin/bob/admin from that same
-- seed against the real `kivo_system` profile, rather than seeding its own.
-- Section 0 deletes any leftovers from a prior interrupted run before
-- seeding; Section 7 deletes everything this script created. The script is
-- safe to re-run.
--
-- READING THE OUTPUT
-- -------------------
-- Sections 2-5 and 6c-6d each end in one SELECT returning (check_name, passed)
-- rows — every `passed` must be `t`. Section 6a/6b's statements are each
-- expected to ERROR with SQLSTATE 42501 ("new row violates row-level security
-- policy"); that error IS the passing outcome and is called out inline.
--
-- HOW TO RUN
-- ----------
-- `psql -f scripts/verify-rls.sql` runs top-to-bottom in one go: psql's
-- default (ON_ERROR_STOP unset) prints an error and keeps going, so section
-- 6's expected errors won't stop section 7's teardown from running.
--
-- Via the Supabase MCP `execute_sql` tool (what this script was authored and
-- verified against, one section per call), each call is one all-or-nothing
-- batch: an error aborts everything after it in that call. Sections 2-6 are
-- each independent (own BEGIN block, own transaction-local id lookups —
-- nothing carries over between sections or depends on call/section order),
-- so run: (a) sections 0-1 together as one call to seed, (b) each of
-- 2/3/4/5/6a/6b/6c/6d/6e/6f/6g/6h/6i/6j as its own call — 6a/6b, several of
-- the individual statements inside 6e/6f/6g, and several inside 6i/6j (each
-- clearly marked "PASS = 42501" or "PASS = 23514") are EXPECTED to come back
-- as a tool error, that error is the pass signal — then (c) section 7 as its
-- own final call regardless of how section 6 went,
-- so cleanup always happens.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Preflight cleanup (idempotent — in case a previous run was interrupted)
-- -----------------------------------------------------------------------------

delete from profiles where username like 'zzrlstest\_%' escape '\';
delete from fixtures where competition_id in (select id from competitions where name like 'ZZ RLS Test%');
delete from players where full_name like 'ZZ RLS Test%';
delete from seasons where competition_id in (select id from competitions where name like 'ZZ RLS Test%');
delete from teams where name like 'ZZ RLS Test%';
delete from competitions where name like 'ZZ RLS Test%';


-- -----------------------------------------------------------------------------
-- 1. Seed synthetic-but-real test fixtures
-- -----------------------------------------------------------------------------
-- Run as the script's own (privileged, RLS-bypassing) connection role — this
-- is the trusted "server-side provisioning" path the real app would use via
-- service_role, not a client insert under test.

insert into profiles (username, clerk_user_id, display_name) values
  ('zzrlstest_alice', 'zzrlstest_clerk_alice', 'ZZ RLS Test Alice'),
  ('zzrlstest_bob',   'zzrlstest_clerk_bob',   'ZZ RLS Test Bob');

insert into competitions (name) values ('ZZ RLS Test Competition');

insert into seasons (competition_id, name, provider_year, is_current)
select id, 'ZZ RLS Test Season', 2025, true from competitions where name = 'ZZ RLS Test Competition';

insert into teams (name) values ('ZZ RLS Test Team A'), ('ZZ RLS Test Team B');

insert into players (full_name, current_team_id)
select 'ZZ RLS Test Player', id from teams where name = 'ZZ RLS Test Team A';

insert into fixtures (competition_id, season_id, home_team_id, away_team_id, kickoff_at)
select c.id, s.id, ta.id, tb.id, now() + interval '2 days'
from competitions c
join seasons s on s.competition_id = c.id
join teams ta on ta.name = 'ZZ RLS Test Team A'
join teams tb on tb.name = 'ZZ RLS Test Team B'
where c.name = 'ZZ RLS Test Competition';

insert into predictions (profile_id, fixture_id, predicted_outcome)
select p.id, f.id, 'home_win'
from profiles p, fixtures f
where p.username = 'zzrlstest_alice'
  and f.home_team_id = (select id from teams where name = 'ZZ RLS Test Team A');

insert into predictions (profile_id, fixture_id, predicted_outcome)
select p.id, f.id, 'away_win'
from profiles p, fixtures f
where p.username = 'zzrlstest_bob'
  and f.home_team_id = (select id from teams where name = 'ZZ RLS Test Team A');

-- Additional seed for items 168/170/172/173 (poll_votes, saves, fan_ratings,
-- get_prediction_consensus — migration 0032/0033/0034): a second, already-
-- finished fixture (fan_ratings_insert_own requires status = 'finished'),
-- plus a poll post with two options. Everything below cascades away with
-- the profiles/fixtures/posts already deleted by section 0's preflight
-- cleanup and section 7's teardown, so no extra cleanup statements are
-- needed for these tables specifically.
--
-- IMPORTANT: this makes TWO fixtures share home_team_id = Team A (this one,
-- plus the original scheduled one above). Every `rls_test.fixture_id`
-- lookup elsewhere in this file that filters only by home_team_id (not also
-- by status) would hit "more than one row returned by a subquery" the
-- moment it runs, from here on — sections 2/3/4/6a/6i disambiguate with
-- `status = 'scheduled'` (matching the original fixture predictions were
-- actually seeded against, below) for exactly this reason; 6g/6h already
-- disambiguated with `status = 'finished'`/`'scheduled'` when they were
-- written. Add the same disambiguation to any new lookup here.
insert into fixtures (competition_id, season_id, home_team_id, away_team_id, kickoff_at, status, home_score, away_score)
select c.id, s.id, ta.id, tb.id, now() - interval '2 hours', 'finished', 2, 1
from competitions c
join seasons s on s.competition_id = c.id
join teams ta on ta.name = 'ZZ RLS Test Team A'
join teams tb on tb.name = 'ZZ RLS Test Team B'
where c.name = 'ZZ RLS Test Competition';

insert into posts (author_profile_id, body)
select id, 'zzrlstest poll: who wins?' from profiles where username = 'zzrlstest_alice';

insert into poll_options (post_id, position, label)
select p.id, 0, 'Team A' from posts p where p.body = 'zzrlstest poll: who wins?'
union all
select p.id, 1, 'Team B' from posts p where p.body = 'zzrlstest poll: who wins?';

insert into notifications (profile_id, type, payload)
select id, 'zzrlstest_marker', '{"note":"alice notification"}'::jsonb
from profiles where username = 'zzrlstest_alice';

insert into notifications (profile_id, type, payload)
select id, 'zzrlstest_marker', '{"note":"bob notification"}'::jsonb
from profiles where username = 'zzrlstest_bob';

insert into fantasy_leagues (name, creator_profile_id, season_id)
select 'ZZ RLS Test League', p.id, s.id
from profiles p, seasons s
where p.username = 'zzrlstest_alice' and s.name = 'ZZ RLS Test Season';

insert into fantasy_teams (owner_profile_id, league_id, name)
select p.id, l.id, 'ZZ RLS Test Team Alice'
from profiles p, fantasy_leagues l
where p.username = 'zzrlstest_alice' and l.name = 'ZZ RLS Test League';

insert into fantasy_teams (owner_profile_id, league_id, name)
select p.id, l.id, 'ZZ RLS Test Team Bob'
from profiles p, fantasy_leagues l
where p.username = 'zzrlstest_bob' and l.name = 'ZZ RLS Test League';

insert into fantasy_gameweeks (season_id, number, deadline_at)
select id, 1, now() + interval '1 day' from seasons where name = 'ZZ RLS Test Season';

insert into fantasy_rosters (fantasy_team_id, gameweek_id, player_id, is_starting)
select t.id, g.id, pl.id, true
from fantasy_teams t, fantasy_gameweeks g, players pl
where t.name = 'ZZ RLS Test Team Alice' and g.number = 1 and pl.full_name = 'ZZ RLS Test Player';

insert into posts (author_profile_id, body)
select id, 'zzrlstest public post by alice' from profiles where username = 'zzrlstest_alice';

insert into posts (author_profile_id, body)
select id, 'zzrlstest public post by bob' from profiles where username = 'zzrlstest_bob';

insert into xp_ledger (profile_id, amount, reason)
select id, 100, 'zzrlstest xp' from profiles where username = 'zzrlstest_alice';

insert into xp_ledger (profile_id, amount, reason)
select id, 50, 'zzrlstest xp' from profiles where username = 'zzrlstest_bob';

-- RECOMMENDATIONS.md item 234 (migration 0045_moderation_status): five more
-- synthetic profiles for section 6i below -- an admin (to exercise the
-- admin-visibility branch of posts_select_public/comments_select_public
-- without touching alice/bob's role and risking section 2/3's existing
-- "sees exactly her own row" counts), one per non-default moderation_status,
-- plus a suspension whose expiry has already elapsed.
insert into profiles (username, clerk_user_id, display_name, role) values
  ('zzrlstest_admin', 'zzrlstest_clerk_admin', 'ZZ RLS Test Admin', 'admin'::user_role);

insert into profiles (username, clerk_user_id, display_name, role, moderation_status, moderation_reason, moderation_expires_at, moderation_set_at)
select 'zzrlstest_carol', 'zzrlstest_clerk_carol', 'ZZ RLS Test Carol', 'user'::user_role, 'suspended'::moderation_status, 'zzrlstest spam links', now() + interval '3 days', now()
union all
select 'zzrlstest_dave', 'zzrlstest_clerk_dave', 'ZZ RLS Test Dave', 'user'::user_role, 'banned'::moderation_status, 'zzrlstest harassment', null, now()
union all
select 'zzrlstest_erin', 'zzrlstest_clerk_erin', 'ZZ RLS Test Erin', 'user'::user_role, 'shadow_muted'::moderation_status, null, null, now()
union all
select 'zzrlstest_frank', 'zzrlstest_clerk_frank', 'ZZ RLS Test Frank', 'user'::user_role, 'suspended'::moderation_status, 'zzrlstest expired already', now() - interval '1 hour', now() - interval '2 days';

update profiles set moderation_set_by = (select id from profiles where username = 'zzrlstest_admin')
where username in ('zzrlstest_carol', 'zzrlstest_dave', 'zzrlstest_erin', 'zzrlstest_frank');


-- -----------------------------------------------------------------------------
-- 2. READ assertions as Alice (authenticated, sub = zzrlstest_clerk_alice)
-- -----------------------------------------------------------------------------
-- Each section from here on is fully self-contained (independent BEGIN block,
-- no dependency on what a previous section left behind), so sections can be
-- run individually and in any order once section 1 has seeded data. Every
-- section that needs a real row id (to avoid the subquery pitfall explained
-- below) derives it itself, transaction-locally, before switching role.

begin;

-- Transaction-local (set_config(..., true)) GUCs capturing alice/bob/the
-- fixture's real generated ids, read here BEFORE switching role — while this
-- transaction is still running as the privileged, RLS-bypassing connection
-- role. This is necessary, not just convenient: a correlated subquery
-- evaluated *after* switching to a restricted role (e.g. `select id from
-- profiles where username = 'zzrlstest_bob'` run as alice) would itself be
-- silently RLS-filtered to zero rows before reaching the statement under
-- test, which would make a check "pass" for the wrong reason (nothing was
-- attempted) instead of the right one (RLS rejected a real, known target id
-- — the realistic threat model, since ids are routinely visible in
-- URLs/API responses). current_setting() reads a GUC, not a table, so once
-- captured it's unaffected by RLS regardless of the active role.
select
  set_config('rls_test.bob_id', (select id::text from profiles where username = 'zzrlstest_bob'), true),
  set_config('rls_test.fixture_id',
    (select id::text from fixtures where status = 'scheduled' and home_team_id = (select id from teams where name = 'ZZ RLS Test Team A')),
    true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_alice","role":"authenticated"}';

select check_name, passed from (
  select 'profiles: alice sees exactly her own row, not bob''s' as check_name,
    (select count(*) from profiles where username like 'zzrlstest_%') = 1
    and exists (select 1 from profiles where username = 'zzrlstest_alice')
    and not exists (select 1 from profiles where username = 'zzrlstest_bob') as passed
  union all
  select 'predictions: alice sees only her own prediction on the shared fixture',
    -- Deliberately scoped by fixture_id (a transaction-local GUC captured
    -- above, from a privileged context) rather than joined through
    -- `profiles`: a
    -- join through profiles would be trivially masked by profiles' OWN RLS
    -- (alice can't see bob's profile row either), so it would "pass" here
    -- even if predictions_select_own were accidentally `using (true)`. This
    -- isolates predictions' own policy specifically.
    (select count(*) from predictions where fixture_id = current_setting('rls_test.fixture_id')::uuid) = 1
    and exists (select 1 from predictions
       where fixture_id = current_setting('rls_test.fixture_id')::uuid and predicted_outcome = 'home_win')
  union all
  select 'notifications: alice sees only her own notification',
    -- Same reasoning: identify "hers" via payload content on the
    -- notifications row itself, not via a join through profiles.
    (select count(*) from notifications where type = 'zzrlstest_marker') = 1
    and exists (select 1 from notifications
       where type = 'zzrlstest_marker' and payload ->> 'note' = 'alice notification')
  union all
  select 'fantasy_teams: alice sees only her own team in the shared league, not bob''s',
    (select count(*) from fantasy_teams where name like 'ZZ RLS Test Team %') = 1
    and exists (select 1 from fantasy_teams where name = 'ZZ RLS Test Team Alice')
  union all
  select 'fantasy_rosters: alice can see her own roster slot',
    exists (select 1 from fantasy_rosters r join fantasy_teams t on t.id = r.fantasy_team_id
       where t.name = 'ZZ RLS Test Team Alice')
  union all
  select 'posts: alice (authenticated) can read bob''s public post',
    exists (select 1 from posts where body = 'zzrlstest public post by bob')
) checks
order by check_name;

rollback;


-- -----------------------------------------------------------------------------
-- 3. READ assertions as Bob (authenticated, sub = zzrlstest_clerk_bob)
-- -----------------------------------------------------------------------------
-- Mirrors section 2 from the other side, to confirm isolation is mutual and
-- not an artifact of insertion order / row ids.

begin;

select set_config('rls_test.fixture_id',
  (select id::text from fixtures where status = 'scheduled' and home_team_id = (select id from teams where name = 'ZZ RLS Test Team A')),
  true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_bob","role":"authenticated"}';

select check_name, passed from (
  select 'profiles: bob sees exactly his own row, not alice''s' as check_name,
    (select count(*) from profiles where username like 'zzrlstest_%') = 1
    and exists (select 1 from profiles where username = 'zzrlstest_bob')
    and not exists (select 1 from profiles where username = 'zzrlstest_alice') as passed
  union all
  select 'predictions: bob sees only his own prediction, not alice''s',
    (select count(*) from predictions where fixture_id = current_setting('rls_test.fixture_id')::uuid) = 1
    and exists (select 1 from predictions
       where fixture_id = current_setting('rls_test.fixture_id')::uuid and predicted_outcome = 'away_win')
  union all
  select 'notifications: bob sees only his own notification, not alice''s',
    (select count(*) from notifications where type = 'zzrlstest_marker') = 1
    and exists (select 1 from notifications
       where type = 'zzrlstest_marker' and payload ->> 'note' = 'bob notification')
  union all
  select 'fantasy_teams: bob sees only his own team, not alice''s',
    (select count(*) from fantasy_teams where name like 'ZZ RLS Test Team %') = 1
    and exists (select 1 from fantasy_teams where name = 'ZZ RLS Test Team Bob')
  union all
  select 'fantasy_rosters: bob cannot see alice''s roster slot (he owns no roster row)',
    not exists (select 1 from fantasy_rosters r join fantasy_teams t on t.id = r.fantasy_team_id
       where t.name = 'ZZ RLS Test Team Alice')
) checks
order by check_name;

rollback;


-- -----------------------------------------------------------------------------
-- 4. READ assertions as anon (no JWT at all — logged-out visitor)
-- -----------------------------------------------------------------------------

begin;

select set_config('rls_test.fixture_id',
  (select id::text from fixtures where status = 'scheduled' and home_team_id = (select id from teams where name = 'ZZ RLS Test Team A')),
  true);

set local role anon;

select check_name, passed from (
  select 'teams: anon can read public reference data' as check_name,
    (select count(*) from teams where name like 'ZZ RLS Test%') = 2 as passed
  union all
  select 'posts: anon can read a public post',
    exists (select 1 from posts where body = 'zzrlstest public post by alice')
  union all
  select 'profiles: anon cannot read any profile row (owner/admin-only table)',
    not exists (select 1 from profiles where username like 'zzrlstest_%')
  union all
  select 'predictions: anon cannot read any prediction row',
    -- Scoped by fixture_id (table-local, no join through profiles) for the
    -- same reason as sections 2/3: a join through profiles would trivially
    -- "pass" here regardless of predictions' own policy, since anon can't
    -- see any profiles row either.
    not exists (select 1 from predictions where fixture_id = current_setting('rls_test.fixture_id')::uuid)
  union all
  select 'notifications: anon cannot read any notification row',
    not exists (select 1 from notifications where type = 'zzrlstest_marker')
  union all
  select 'fantasy_teams: anon cannot read any fantasy team row',
    not exists (select 1 from fantasy_teams where name like 'ZZ RLS Test Team %')
) checks
order by check_name;

rollback;


-- -----------------------------------------------------------------------------
-- 5. WRITE assertions: cross-user UPDATE/DELETE silently affect 0 rows
-- -----------------------------------------------------------------------------
-- These don't raise errors (unlike section 6) — an update/delete whose USING
-- clause matches nothing just succeeds with a 0-row result, which is exactly
-- the failure mode a missing/loose policy would NOT produce, so it needs an
-- explicit assertion rather than "no error = safe".

begin;

select set_config('rls_test.bob_id', (select id::text from profiles where username = 'zzrlstest_bob'), true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_alice","role":"authenticated"}';

-- Targets bob by his real id, captured just above (see the set_config note
-- earlier in the file) — NOT via `where profile_id = (select id from
-- profiles where username = 'zzrlstest_bob')`, because that subquery would
-- itself be RLS-filtered to zero rows under alice's restricted role (she
-- can't see bob's profile row), making the UPDATE/DELETE a no-op for the
-- wrong reason (an empty subquery) rather than the right one
-- (predictions_update_own_unlocked's USING clause rejecting a real, known
-- target id).
with upd_attempt as (
  update predictions set predicted_outcome = 'draw'
  where profile_id = current_setting('rls_test.bob_id')::uuid
  returning id
),
del_attempt as (
  delete from notifications
  where profile_id = current_setting('rls_test.bob_id')::uuid
  returning id
),
fantasy_upd_attempt as (
  update fantasy_teams set name = 'hijacked'
  where owner_profile_id = current_setting('rls_test.bob_id')::uuid
  returning id
)
select 'writes as alice: UPDATE on bob''s prediction affects 0 rows' as check_name,
       (select count(*) from upd_attempt) = 0 as passed
union all
select 'writes as alice: DELETE on bob''s notification affects 0 rows',
       (select count(*) from del_attempt) = 0
union all
select 'writes as alice: UPDATE on bob''s fantasy_team affects 0 rows',
       (select count(*) from fantasy_upd_attempt) = 0;

rollback;

-- Confirm bob's rows are genuinely untouched after the attempts above (belt
-- and suspenders — the ROLLBACK already guarantees this, but this re-checks
-- from a neutral, RLS-bypassing connection so the assertion doesn't rely
-- solely on transactional rollback behaving as expected).
select 'writes as alice: bob''s prediction outcome unchanged after rollback' as check_name,
  (select predicted_outcome::text from predictions p join profiles pr on pr.id = p.profile_id
     where pr.username = 'zzrlstest_bob') = 'away_win' as passed
union all
select 'writes as alice: bob''s notification still exists after rollback',
  exists (select 1 from notifications n join profiles pr on pr.id = n.profile_id
     where pr.username = 'zzrlstest_bob' and n.type = 'zzrlstest_marker');


-- -----------------------------------------------------------------------------
-- 6. WRITE assertions: cross-user INSERT is rejected outright
-- -----------------------------------------------------------------------------
-- Unlike section 5, a WITH CHECK failure on INSERT raises a hard Postgres
-- error (SQLSTATE 42501 "new row violates row-level security policy"),
-- verified live against this project. Each statement below is EXPECTED TO
-- ERROR — that error is the passing outcome, confirmed by hand while
-- authoring this script. Run each in its own transaction (as here) since the
-- error aborts the transaction.

-- 6a. PASS = this errors with 42501 (alice cannot insert a prediction owned by
-- bob, even though she supplies bob's *real* profile_id directly — see the
-- set_config note earlier in the file for why this uses current_setting()
-- rather than a subquery).
begin;

select
  set_config('rls_test.bob_id', (select id::text from profiles where username = 'zzrlstest_bob'), true),
  set_config('rls_test.fixture_id',
    (select id::text from fixtures where status = 'scheduled' and home_team_id = (select id from teams where name = 'ZZ RLS Test Team A')),
    true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_alice","role":"authenticated"}';
insert into predictions (profile_id, fixture_id, predicted_outcome)
values (current_setting('rls_test.bob_id')::uuid, current_setting('rls_test.fixture_id')::uuid, 'draw');
rollback;

-- 6b. PASS = this errors with 42501 (anon cannot insert a notification for
-- anyone — there is no insert policy on `notifications` for any client role).
begin;

select set_config('rls_test.alice_id', (select id::text from profiles where username = 'zzrlstest_alice'), true);

set local role anon;
insert into notifications (profile_id, type)
values (current_setting('rls_test.alice_id')::uuid, 'zzrlstest_forged');
rollback;


-- -----------------------------------------------------------------------------
-- 6c. get_xp_total(uuid) self-scoping: it bypasses RLS as SECURITY DEFINER,
-- so its own internal ownership check (p_profile_id = current_profile_id())
-- is the only thing standing between "sum my own ledger" and "sum anyone's
-- ledger by passing their id" — worth its own explicit check.
-- -----------------------------------------------------------------------------

begin;

select
  set_config('rls_test.alice_id', (select id::text from profiles where username = 'zzrlstest_alice'), true),
  set_config('rls_test.bob_id', (select id::text from profiles where username = 'zzrlstest_bob'), true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_alice","role":"authenticated"}';

select check_name, passed from (
  select 'get_xp_total: alice gets her own real total (100)' as check_name,
    public.get_xp_total(current_setting('rls_test.alice_id')::uuid) = 100 as passed
  union all
  select 'get_xp_total: alice querying bob''s id returns 0, not bob''s real total (50)',
    public.get_xp_total(current_setting('rls_test.bob_id')::uuid) = 0
) checks
order by check_name;

rollback;


-- -----------------------------------------------------------------------------
-- 6d. mark_notifications_read(uuid[]) ownership scoping: replaced the old
-- notifications_update_own RLS policy (RECOMMENDATIONS item 38), so this is
-- the only remaining write path onto notifications.read_at for authenticated
-- users — worth verifying directly rather than trusting the RLS-policy
-- checks in section 5/6 to cover it, since it's a function, not a policy.
-- -----------------------------------------------------------------------------

begin;

select set_config('rls_test.alice_notif_id',
  (select n.id::text from notifications n join profiles p on p.id = n.profile_id
     where p.username = 'zzrlstest_alice' and n.type = 'zzrlstest_marker'),
  true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_bob","role":"authenticated"}';

select public.mark_notifications_read(array[current_setting('rls_test.alice_notif_id')::uuid]);

select 'mark_notifications_read: bob calling it on alice''s notification id does not mark it read' as check_name,
  (select read_at from notifications where id = current_setting('rls_test.alice_notif_id')::uuid) is null as passed;

rollback;

begin;

select set_config('rls_test.alice_notif_id',
  (select n.id::text from notifications n join profiles p on p.id = n.profile_id
     where p.username = 'zzrlstest_alice' and n.type = 'zzrlstest_marker'),
  true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_alice","role":"authenticated"}';

select public.mark_notifications_read(array[current_setting('rls_test.alice_notif_id')::uuid]);

select 'mark_notifications_read: alice marking her own notification does set read_at' as check_name,
  (select read_at from notifications where id = current_setting('rls_test.alice_notif_id')::uuid) is not null as passed;

rollback;


-- -----------------------------------------------------------------------------
-- 6e. poll_votes (RECOMMENDATIONS item 172, migration 0032): predictions'
-- one-pick-per-user shape, plus a BEFORE INSERT trigger that re-derives
-- post_id from the real option server-side — the anti-spoofing property
-- checked first, before the standard cross-user/anon checks.
-- -----------------------------------------------------------------------------

-- Alice votes for option A while deliberately supplying a wrong post_id —
-- PASS = the stored row's post_id is the option's real post anyway.
begin;

select
  set_config('rls_test.option_a_id', (select o.id::text from poll_options o join posts p on p.id = o.post_id where p.body = 'zzrlstest poll: who wins?' and o.position = 0), true),
  set_config('rls_test.real_post_id', (select p.id::text from posts p where p.body = 'zzrlstest poll: who wins?'), true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_alice","role":"authenticated"}';

insert into poll_votes (post_id, option_id, profile_id)
values (gen_random_uuid(), current_setting('rls_test.option_a_id')::uuid, (select id from profiles where username = 'zzrlstest_alice'));

select 'poll_votes: trigger overwrites a spoofed post_id with the option''s real post_id' as check_name,
  (select post_id from poll_votes where profile_id = (select id from profiles where username = 'zzrlstest_alice'))
    = current_setting('rls_test.real_post_id')::uuid as passed;

commit;

-- Bob casts his own real vote on option B (needed for the aggregate checks below).
begin;

select set_config('rls_test.option_b_id', (select o.id::text from poll_options o join posts p on p.id = o.post_id where p.body = 'zzrlstest poll: who wins?' and o.position = 1), true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_bob","role":"authenticated"}';

insert into poll_votes (post_id, option_id, profile_id)
values (current_setting('rls_test.option_b_id')::uuid, current_setting('rls_test.option_b_id')::uuid, (select id from profiles where username = 'zzrlstest_bob'));

commit;

-- PASS = 42501 (alice cannot forge a vote as bob, even with his real profile_id).
begin;

select
  set_config('rls_test.bob_id', (select id::text from profiles where username = 'zzrlstest_bob'), true),
  set_config('rls_test.option_b_id', (select o.id::text from poll_options o join posts p on p.id = o.post_id where p.body = 'zzrlstest poll: who wins?' and o.position = 1), true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_alice","role":"authenticated"}';

insert into poll_votes (post_id, option_id, profile_id)
values (gen_random_uuid(), current_setting('rls_test.option_b_id')::uuid, current_setting('rls_test.bob_id')::uuid);

rollback;

begin;

select set_config('rls_test.real_post_id', (select p.id::text from posts p where p.body = 'zzrlstest poll: who wins?'), true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_alice","role":"authenticated"}';

with del_attempt as (
  delete from poll_votes
  where profile_id = (select id from profiles where username = 'zzrlstest_bob')
  returning id
)
select check_name, passed from (
  select 'poll_votes: alice sees exactly her own vote on this poll, not bob''s' as check_name,
    (select count(*) from poll_votes where post_id = current_setting('rls_test.real_post_id')::uuid) = 1
    and exists (select 1 from poll_votes v join profiles p on p.id = v.profile_id where p.username = 'zzrlstest_alice')
    and not exists (select 1 from poll_votes v join profiles p on p.id = v.profile_id where p.username = 'zzrlstest_bob') as passed
  union all
  select 'poll_votes: alice deleting bob''s vote affects 0 rows', (select count(*) from del_attempt) = 0
) checks
order by check_name;

rollback;

begin;

select set_config('rls_test.real_post_id', (select p.id::text from posts p where p.body = 'zzrlstest poll: who wins?'), true);

set local role anon;

select check_name, passed from (
  select 'poll_votes: anon cannot read any vote row' as check_name,
    not exists (select 1 from poll_votes where post_id = current_setting('rls_test.real_post_id')::uuid) as passed
  union all
  select 'poll_options: anon CAN read the public options (poll question/choices are public)',
    (select count(*) from poll_options where post_id = current_setting('rls_test.real_post_id')::uuid) = 2
  union all
  select 'get_poll_results: anon gets real per-option counts (1 vote each), never a profile_id',
    (
      (select count(*) from public.get_poll_results(current_setting('rls_test.real_post_id')::uuid)) = 2
      and (select sum(vote_count) from public.get_poll_results(current_setting('rls_test.real_post_id')::uuid)) = 2
    )
) checks
order by check_name;

rollback;

-- PASS = 42501 (no anon insert policy on poll_votes at all).
begin;
select set_config('rls_test.option_a_id', (select o.id::text from poll_options o join posts p on p.id = o.post_id where p.body = 'zzrlstest poll: who wins?' and o.position = 0), true);
set local role anon;
insert into poll_votes (post_id, option_id, profile_id)
values (gen_random_uuid(), current_setting('rls_test.option_a_id')::uuid, (select id from profiles where username = 'zzrlstest_alice'));
rollback;


-- -----------------------------------------------------------------------------
-- 6f. saves (RECOMMENDATIONS item 173, migration 0032): exact mirror of
-- follows' RLS shape — own-row select/insert/delete only.
-- -----------------------------------------------------------------------------

begin;
select set_config('rls_test.post_id', (select id::text from posts where body = 'zzrlstest poll: who wins?'), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_alice","role":"authenticated"}';
insert into saves (profile_id, target_type, target_id)
values ((select id from profiles where username = 'zzrlstest_alice'), 'post', current_setting('rls_test.post_id')::uuid);
commit;

begin;
select set_config('rls_test.team_a_id', (select id::text from teams where name = 'ZZ RLS Test Team A'), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_bob","role":"authenticated"}';
insert into saves (profile_id, target_type, target_id)
values ((select id from profiles where username = 'zzrlstest_bob'), 'team', current_setting('rls_test.team_a_id')::uuid);
commit;

-- PASS = 42501 (alice cannot forge a save as bob, even with his real profile_id).
begin;
select
  set_config('rls_test.bob_id', (select id::text from profiles where username = 'zzrlstest_bob'), true),
  set_config('rls_test.team_b_id', (select id::text from teams where name = 'ZZ RLS Test Team B'), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_alice","role":"authenticated"}';
insert into saves (profile_id, target_type, target_id)
values (current_setting('rls_test.bob_id')::uuid, 'team', current_setting('rls_test.team_b_id')::uuid);
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_alice","role":"authenticated"}';

with del_attempt as (
  delete from saves
  where profile_id = (select id from profiles where username = 'zzrlstest_bob')
  returning id
)
select check_name, passed from (
  select 'saves: alice sees exactly her own save, not bob''s' as check_name,
    (select count(*) from saves where profile_id in (select id from profiles where username like 'zzrlstest_%')) = 1
    and exists (select 1 from saves s join profiles p on p.id = s.profile_id where p.username = 'zzrlstest_alice')
    and not exists (select 1 from saves s join profiles p on p.id = s.profile_id where p.username = 'zzrlstest_bob') as passed
  union all
  select 'saves: alice deleting bob''s save affects 0 rows', (select count(*) from del_attempt) = 0
) checks
order by check_name;

rollback;

begin;
set local role anon;
select 'saves: anon cannot read any save row' as check_name,
  not exists (select 1 from saves where profile_id in (select id from profiles where username like 'zzrlstest_%')) as passed;
rollback;

-- PASS = 42501 (no anon insert policy on saves at all).
begin;
select set_config('rls_test.post_id', (select id::text from posts where body = 'zzrlstest poll: who wins?'), true);
set local role anon;
insert into saves (profile_id, target_type, target_id)
values ((select id from profiles where username = 'zzrlstest_bob'), 'post', current_setting('rls_test.post_id')::uuid);
rollback;


-- -----------------------------------------------------------------------------
-- 6g. fan_ratings (RECOMMENDATIONS item 170, migration 0032): RLS mirrors
-- predictions' own-row shape, plus a WITH CHECK requiring the fixture to
-- actually be finished ("rate a performance after the whistle").
-- -----------------------------------------------------------------------------

begin;
select set_config('rls_test.finished_fixture_id', (select id::text from fixtures where status = 'finished' and home_team_id = (select id from teams where name = 'ZZ RLS Test Team A')), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_alice","role":"authenticated"}';
insert into fan_ratings (profile_id, fixture_id, rating)
values ((select id from profiles where username = 'zzrlstest_alice'), current_setting('rls_test.finished_fixture_id')::uuid, 5);
commit;

begin;
select set_config('rls_test.finished_fixture_id', (select id::text from fixtures where status = 'finished' and home_team_id = (select id from teams where name = 'ZZ RLS Test Team A')), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_bob","role":"authenticated"}';
insert into fan_ratings (profile_id, fixture_id, rating)
values ((select id from profiles where username = 'zzrlstest_bob'), current_setting('rls_test.finished_fixture_id')::uuid, 3);
commit;

-- PASS = 42501 (alice cannot rate a fixture that hasn't finished yet — RLS
-- itself enforces this, not just the server action).
begin;
select set_config('rls_test.scheduled_fixture_id', (select id::text from fixtures where status = 'scheduled' and home_team_id = (select id from teams where name = 'ZZ RLS Test Team A')), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_alice","role":"authenticated"}';
insert into fan_ratings (profile_id, fixture_id, rating)
values ((select id from profiles where username = 'zzrlstest_alice'), current_setting('rls_test.scheduled_fixture_id')::uuid, 4);
rollback;

-- PASS = 42501 (alice cannot forge a rating as bob, real finished fixture, wrong owner).
begin;
select
  set_config('rls_test.bob_id', (select id::text from profiles where username = 'zzrlstest_bob'), true),
  set_config('rls_test.finished_fixture_id', (select id::text from fixtures where status = 'finished' and home_team_id = (select id from teams where name = 'ZZ RLS Test Team A')), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_alice","role":"authenticated"}';
insert into fan_ratings (profile_id, fixture_id, rating)
values (current_setting('rls_test.bob_id')::uuid, current_setting('rls_test.finished_fixture_id')::uuid, 1);
rollback;

begin;
select set_config('rls_test.finished_fixture_id', (select id::text from fixtures where status = 'finished' and home_team_id = (select id from teams where name = 'ZZ RLS Test Team A')), true),
       set_config('rls_test.bob_id', (select id::text from profiles where username = 'zzrlstest_bob'), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_alice","role":"authenticated"}';

with upd_attempt as (
  update fan_ratings set rating = 1
  where profile_id = current_setting('rls_test.bob_id')::uuid
  returning id
),
del_attempt as (
  delete from fan_ratings
  where profile_id = current_setting('rls_test.bob_id')::uuid
  returning id
)
select check_name, passed from (
  select 'fan_ratings: alice sees exactly her own rating on this fixture, not bob''s' as check_name,
    (select count(*) from fan_ratings where fixture_id = current_setting('rls_test.finished_fixture_id')::uuid) = 1
    and exists (select 1 from fan_ratings r join profiles p on p.id = r.profile_id where p.username = 'zzrlstest_alice' and r.rating = 5)
    and not exists (select 1 from fan_ratings r join profiles p on p.id = r.profile_id where p.username = 'zzrlstest_bob') as passed
  union all
  select 'fan_ratings: alice updating bob''s rating affects 0 rows', (select count(*) from upd_attempt) = 0
  union all
  select 'fan_ratings: alice deleting bob''s rating affects 0 rows', (select count(*) from del_attempt) = 0
) checks
order by check_name;

rollback;

begin;
select set_config('rls_test.finished_fixture_id', (select id::text from fixtures where status = 'finished' and home_team_id = (select id from teams where name = 'ZZ RLS Test Team A')), true);
set local role anon;
select check_name, passed from (
  select 'fan_ratings: anon cannot read any individual rating row' as check_name,
    not exists (select 1 from fan_ratings where fixture_id = current_setting('rls_test.finished_fixture_id')::uuid) as passed
  union all
  select 'get_fan_rating_summary: anon gets the real aggregate (count=2, avg=4.0) despite the base table being unreadable to anon',
    (
      (select rating_count from public.get_fan_rating_summary(current_setting('rls_test.finished_fixture_id')::uuid)) = 2
      and (select avg_rating from public.get_fan_rating_summary(current_setting('rls_test.finished_fixture_id')::uuid)) = 4.0
    )
) checks
order by check_name;
rollback;


-- -----------------------------------------------------------------------------
-- 6h. get_prediction_consensus (RECOMMENDATIONS item 168, migration 0032):
-- real per-outcome pick counts despite predictions_select_own, never an
-- individual profile_id.
-- -----------------------------------------------------------------------------

begin;
select set_config('rls_test.scheduled_fixture_id', (select id::text from fixtures where status = 'scheduled' and home_team_id = (select id from teams where name = 'ZZ RLS Test Team A')), true);
set local role anon;
select check_name, passed from (
  select 'get_prediction_consensus: anon gets real per-outcome counts (1 home_win, 1 away_win) with no individual picker identity' as check_name,
    (
      (select count(*) from public.get_prediction_consensus(array[current_setting('rls_test.scheduled_fixture_id')::uuid])) = 2
      and (select pick_count from public.get_prediction_consensus(array[current_setting('rls_test.scheduled_fixture_id')::uuid]) where predicted_outcome = 'home_win') = 1
      and (select pick_count from public.get_prediction_consensus(array[current_setting('rls_test.scheduled_fixture_id')::uuid]) where predicted_outcome = 'away_win') = 1
    ) as passed
) checks;
rollback;


-- -----------------------------------------------------------------------------
-- 6i. moderation_status enforcement (RECOMMENDATIONS.md item 234, migration
-- 0045_moderation_status): proves suspended/banned writes are genuinely
-- rejected by RLS (not merely hidden), shadow_muted content is genuinely
-- invisible to everyone but its author and admins, a suspended/banned user
-- cannot self-reinstate through an ordinary profile update, an unrelated
-- self-edit (bio) by that same suspended user still succeeds (only the
-- moderation columns are locked, not the whole row), and a suspension whose
-- moderation_expires_at has already elapsed is lazily treated as active on
-- next read/write with no cron or manual reinstate step. Live-verified by
-- hand against project gkyjfihxxdynfwqhhpyn while authoring this section
-- (each numbered check below, plus every "PASS = 42501/23514" statement).
-- -----------------------------------------------------------------------------

-- PASS = 42501 (carol is suspended; her own post insert is rejected, not
-- merely hidden later).
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_carol","role":"authenticated"}';
insert into posts (author_profile_id, body)
select id, 'zzrlstest carol trying to post while suspended' from profiles where username = 'zzrlstest_carol';
rollback;

-- PASS = 42501 (carol is suspended; her own prediction insert is rejected).
begin;
select set_config('rls_test.fixture_id',
  (select id::text from fixtures where status = 'scheduled' and home_team_id = (select id from teams where name = 'ZZ RLS Test Team A')), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_carol","role":"authenticated"}';
insert into predictions (profile_id, fixture_id, predicted_outcome)
select id, current_setting('rls_test.fixture_id')::uuid, 'home_win' from profiles where username = 'zzrlstest_carol';
rollback;

-- PASS = 42501 (dave is banned; his own reaction insert on alice's real
-- public post is rejected).
begin;
select set_config('rls_test.post_id', (select id::text from posts where body = 'zzrlstest public post by alice'), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_dave","role":"authenticated"}';
insert into reactions (target_type, target_id, profile_id, reaction_type)
select 'post', current_setting('rls_test.post_id')::uuid, id, 'like' from profiles where username = 'zzrlstest_dave';
rollback;

-- PASS = 42501 (carol cannot self-reinstate: profiles_update_own_or_admin's
-- owner branch now also requires the moderation snapshot to stay unchanged,
-- so this direct attempt to clear her own suspension is rejected outright —
-- not just re-overwritten by the next lazy-expiry read).
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_carol","role":"authenticated"}';
update profiles set moderation_status = 'active', moderation_reason = null, moderation_expires_at = null
where username = 'zzrlstest_carol';
rollback;

-- Belt and suspenders on the check above: confirm from a neutral,
-- RLS-bypassing connection that carol's suspension really is still there
-- (the ROLLBACK already guarantees this; this re-checks independently, same
-- reasoning as section 5's post-rollback re-checks).
select 'moderation: carol''s suspension is unchanged after her rejected self-update attempt' as check_name,
  (select moderation_status::text from profiles where username = 'zzrlstest_carol') = 'suspended' as passed;

-- Contrast case: carol CAN still edit an unrelated field (bio) of her own
-- row while suspended -- the self-tamper guard locks only the 5 moderation
-- columns, not the whole row, so an ordinary profile edit isn't silently
-- broken by being suspended.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_carol","role":"authenticated"}';
update profiles set bio = 'zzrlstest carol updated bio while suspended' where username = 'zzrlstest_carol';
select 'moderation: carol can still edit her own bio while suspended' as check_name,
  (select bio from profiles where username = 'zzrlstest_carol') = 'zzrlstest carol updated bio while suspended' as passed;
rollback;

-- shadow_muted: erin can post with zero visible friction to herself...
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_erin","role":"authenticated"}';
insert into posts (author_profile_id, body)
select id, 'zzrlstest erin shadow muted post' from profiles where username = 'zzrlstest_erin';
select 'moderation: erin (shadow_muted) can post with zero friction' as check_name,
  exists (select 1 from posts where body = 'zzrlstest erin shadow muted post') as passed;
commit;

-- ...but bob (an ordinary other user) genuinely cannot see it...
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_bob","role":"authenticated"}';
select 'moderation: bob cannot see erin (shadow_muted)''s post' as check_name,
  not exists (select 1 from posts where body = 'zzrlstest erin shadow muted post') as passed;
rollback;

-- ...nor can a logged-out visitor...
begin;
set local role anon;
select 'moderation: anon cannot see erin (shadow_muted)''s post' as check_name,
  not exists (select 1 from posts where body = 'zzrlstest erin shadow muted post') as passed;
rollback;

-- ...while erin herself and an admin both still can (self and admin are the
-- two carve-outs posts_select_public/comments_select_public grant).
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_erin","role":"authenticated"}';
select 'moderation: erin can see her own shadow_muted post' as check_name,
  exists (select 1 from posts where body = 'zzrlstest erin shadow muted post') as passed;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_admin","role":"authenticated"}';
select 'moderation: admin can see erin''s shadow_muted post' as check_name,
  exists (select 1 from posts where body = 'zzrlstest erin shadow muted post') as passed;
rollback;

-- Lazy expiry: frank's moderation_expires_at is already in the past. No cron
-- job exists anywhere in this codebase (by design) to sweep this -- reading
-- his effective status must resolve to 'active' purely from the comparison
-- against now() happening at read time, and his write must actually succeed.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_frank","role":"authenticated"}';

select check_name, passed from (
  select 'moderation: frank (expired suspension) effective status reads active' as check_name,
    private.current_moderation_status() = 'active' as passed
  union all
  select 'moderation: frank (expired suspension) is not write-blocked',
    private.is_moderation_write_blocked() = false
) checks
order by check_name;

insert into posts (author_profile_id, body)
select id, 'zzrlstest frank posting after lazy expiry' from profiles where username = 'zzrlstest_frank';

select 'moderation: frank can actually post after lazy expiry, no cron/manual step involved' as check_name,
  exists (select 1 from posts where body = 'zzrlstest frank posting after lazy expiry') as passed;
rollback;

-- Check constraints: suspend/ban without a reason, or a non-suspended row
-- carrying an expiry, are rejected at the database itself (PASS = 23514),
-- independent of the admin UI's own required-field validation.
begin;
update profiles set moderation_status = 'suspended', moderation_reason = null, moderation_expires_at = now() + interval '1 day'
where username = 'zzrlstest_bob';
rollback;

begin;
update profiles set moderation_status = 'banned', moderation_reason = 'zzrlstest test', moderation_expires_at = now() + interval '1 day'
where username = 'zzrlstest_bob';
rollback;


-- -----------------------------------------------------------------------------
-- 6j. Match Room posts + is_system lockdown (this task's own build:
-- RECOMMENDATIONS.md items 1/2/4, migration
-- 0047_match_room_system_posts). Room posts are ordinary `posts` rows with
-- fixture_id set — this proves the exact same moderation_status enforcement
-- 6i already proved for a general post also genuinely applies once
-- fixture_id is set (checked directly, not assumed to "just transfer"
-- because it's the same table), and that `is_system` can never be forged by
-- a real authenticated user's own insert or update, only by a service-role
-- write (match-room-system-posts.ts's insertSystemEventPost). Live-verified
-- by hand against project gkyjfihxxdynfwqhhpyn while authoring this
-- section, same as every check in 6i.
-- -----------------------------------------------------------------------------

-- PASS = 42501 (carol is suspended; her Room post insert — fixture_id set —
-- is rejected exactly like her general post insert in 6i).
begin;
select set_config('rls_test.fixture_id',
  (select id::text from fixtures where status = 'scheduled' and home_team_id = (select id from teams where name = 'ZZ RLS Test Team A')), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_carol","role":"authenticated"}';
insert into posts (author_profile_id, fixture_id, body)
select id, current_setting('rls_test.fixture_id')::uuid, 'zzrlstest carol trying to post in room while suspended' from profiles where username = 'zzrlstest_carol';
rollback;

-- shadow_muted in a Room post: erin can post into the room with zero
-- friction to herself...
begin;
select set_config('rls_test.fixture_id',
  (select id::text from fixtures where status = 'scheduled' and home_team_id = (select id from teams where name = 'ZZ RLS Test Team A')), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_erin","role":"authenticated"}';
insert into posts (author_profile_id, fixture_id, body)
select id, current_setting('rls_test.fixture_id')::uuid, 'zzrlstest erin shadow muted room post' from profiles where username = 'zzrlstest_erin';
select 'moderation: erin (shadow_muted) can post in the Room with zero friction' as check_name,
  exists (select 1 from posts where body = 'zzrlstest erin shadow muted room post') as passed;
commit;

-- ...but bob (an ordinary other user) genuinely cannot see it in the Room
-- either...
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_bob","role":"authenticated"}';
select 'moderation: bob cannot see erin (shadow_muted)''s Room post' as check_name,
  not exists (select 1 from posts where body = 'zzrlstest erin shadow muted room post') as passed;
rollback;

-- ...nor can a logged-out visitor...
begin;
set local role anon;
select 'moderation: anon cannot see erin (shadow_muted)''s Room post' as check_name,
  not exists (select 1 from posts where body = 'zzrlstest erin shadow muted room post') as passed;
rollback;

-- ...while erin herself and an admin both still can.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_erin","role":"authenticated"}';
select 'moderation: erin can see her own shadow_muted Room post' as check_name,
  exists (select 1 from posts where body = 'zzrlstest erin shadow muted room post') as passed;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_admin","role":"authenticated"}';
select 'moderation: admin can see erin''s shadow_muted Room post' as check_name,
  exists (select 1 from posts where body = 'zzrlstest erin shadow muted room post') as passed;
rollback;

-- Cleanup for erin's committed Room post above (the one `commit`, not
-- `rollback`, in this section) — same reasoning as 6i's own erin commit: it
-- has to actually persist for bob/admin's visibility checks above to have
-- anything real to read.
delete from posts where body = 'zzrlstest erin shadow muted room post';

-- is_system anti-impersonation. PASS = 42501: bob (an ordinary, unrestricted
-- user) cannot insert a post claiming is_system = true — i.e. cannot dress
-- his own post up as an official KIVO update.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_bob","role":"authenticated"}';
insert into posts (author_profile_id, body, is_system)
select id, 'zzrlstest bob forging a system post', true from profiles where username = 'zzrlstest_bob';
rollback;

-- PASS = 42501: bob also cannot UPDATE his own real, already-existing post
-- to retroactively flip is_system to true.
begin;
select set_config('rls_test.post_id', (select id::text from posts where body = 'zzrlstest public post by bob'), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_bob","role":"authenticated"}';
update posts set is_system = true where id = current_setting('rls_test.post_id')::uuid;
rollback;

-- Belt and suspenders on the two checks above (same reasoning as 6i's own
-- post-rollback re-checks): confirm from a neutral, RLS-bypassing
-- connection that bob's real post genuinely still has is_system = false.
select 'is_system: bob''s real post is still is_system = false after his rejected forge attempts' as check_name,
  (select is_system from posts where body = 'zzrlstest public post by bob') = false as passed;

-- Positive path: the real KIVO system profile (seeded by migration
-- 0047_match_room_system_posts, the same trust boundary a service-role
-- write from match-room-system-posts.ts operates under) can genuinely
-- author an is_system post, and posts_select_public has no hidden extra
-- gate on is_system specifically — an ordinary user reads it exactly like
-- any other public post.
begin;
select set_config('rls_test.fixture_id',
  (select id::text from fixtures where status = 'scheduled' and home_team_id = (select id from teams where name = 'ZZ RLS Test Team A')), true);
insert into posts (author_profile_id, fixture_id, body, is_system)
select id, current_setting('rls_test.fixture_id')::uuid, 'zzrlstest system goal post', true from profiles where username = 'kivo_system';
set local role authenticated;
set local request.jwt.claims = '{"sub":"zzrlstest_clerk_bob","role":"authenticated"}';
select 'is_system: bob (ordinary user) can read the real KIVO system post' as check_name,
  exists (select 1 from posts where body = 'zzrlstest system goal post' and is_system = true) as passed;
rollback;


-- -----------------------------------------------------------------------------
-- 7. Teardown — remove every row this script created
-- -----------------------------------------------------------------------------

delete from profiles where username like 'zzrlstest\_%' escape '\';
delete from fixtures where competition_id in (select id from competitions where name like 'ZZ RLS Test%');
delete from players where full_name like 'ZZ RLS Test%';
delete from seasons where competition_id in (select id from competitions where name like 'ZZ RLS Test%');
delete from teams where name like 'ZZ RLS Test%';
delete from competitions where name like 'ZZ RLS Test%';

-- Final sanity check: confirm cleanup left no trace. poll_options/poll_votes/
-- saves/fan_ratings have no zzrlstest-prefixed column of their own to filter
-- on directly (saves/fan_ratings key off profile_id, poll_options/poll_votes
-- off post_id) — deleting profiles/fixtures/posts above cascades to all four
-- via their own FKs (0032), so an unqualified emptiness check on each is a
-- real assertion, not a tautology: if cascade delete were ever broken, rows
-- from a completely different, real poll/save/rating would still make this
-- fail too. Safe only because this script is the sole writer of test data
-- against a project that otherwise has none yet (rows: 0 per list_tables).
select 'teardown: no zzrlstest rows remain in any seeded table' as check_name,
  not exists (select 1 from profiles where username like 'zzrlstest_%')
  and not exists (select 1 from teams where name like 'ZZ RLS Test%')
  and not exists (select 1 from competitions where name like 'ZZ RLS Test%')
  and not exists (select 1 from players where full_name like 'ZZ RLS Test%')
  and not exists (select 1 from posts where body like 'zzrlstest%')
  and not exists (select 1 from poll_options)
  and not exists (select 1 from poll_votes)
  and not exists (select 1 from saves)
  and not exists (select 1 from fan_ratings) as passed;
