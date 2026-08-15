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
-- unambiguously test data. Section 0 deletes any leftovers from a prior
-- interrupted run before seeding; Section 7 deletes everything this script
-- created. The script is safe to re-run.
--
-- READING THE OUTPUT
-- -------------------
-- Sections 2-5 each end in one SELECT returning (check_name, passed) rows —
-- every `passed` must be `t`. Section 6's statements are each expected to
-- ERROR with SQLSTATE 42501 ("new row violates row-level security policy");
-- that error IS the passing outcome and is called out inline.
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
-- 2/3/4/5/6a/6b as its own call — 6a and 6b are EXPECTED to come back as a
-- tool error, that error is the pass signal — then (c) section 7 as its own
-- final call regardless of how section 6 went, so cleanup always happens.
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

insert into seasons (competition_id, name, is_current)
select id, 'ZZ RLS Test Season', true from competitions where name = 'ZZ RLS Test Competition';

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
    (select id::text from fixtures where home_team_id = (select id from teams where name = 'ZZ RLS Test Team A')),
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
  (select id::text from fixtures where home_team_id = (select id from teams where name = 'ZZ RLS Test Team A')),
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
  (select id::text from fixtures where home_team_id = (select id from teams where name = 'ZZ RLS Test Team A')),
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
    (select id::text from fixtures where home_team_id = (select id from teams where name = 'ZZ RLS Test Team A')),
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
-- 7. Teardown — remove every row this script created
-- -----------------------------------------------------------------------------

delete from profiles where username like 'zzrlstest\_%' escape '\';
delete from fixtures where competition_id in (select id from competitions where name like 'ZZ RLS Test%');
delete from players where full_name like 'ZZ RLS Test%';
delete from seasons where competition_id in (select id from competitions where name like 'ZZ RLS Test%');
delete from teams where name like 'ZZ RLS Test%';
delete from competitions where name like 'ZZ RLS Test%';

-- Final sanity check: confirm cleanup left no trace.
select 'teardown: no zzrlstest rows remain in any seeded table' as check_name,
  not exists (select 1 from profiles where username like 'zzrlstest_%')
  and not exists (select 1 from teams where name like 'ZZ RLS Test%')
  and not exists (select 1 from competitions where name like 'ZZ RLS Test%')
  and not exists (select 1 from players where full_name like 'ZZ RLS Test%') as passed;
