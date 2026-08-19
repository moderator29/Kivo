-- =============================================================================
-- Adversarial QA pass: the write rules that only existed in application code
-- =============================================================================
-- APPLIED to the live project (gkyjfihxxdynfwqhhpyn) on 2026-08-19 by the
-- security-sweep agent. Findings written up in docs/SECURITY_REVIEW.md. Every
-- change here has the same shape, and it is worth naming the shape once:
--
--   A rule that only a server action enforces is not enforced.
--
-- KIVO's server actions are careful. `submitPrediction` refuses a fixture that
-- has kicked off; `setGameweekRoster` and `setFantasyCaptain` both refuse a
-- gameweek past its deadline. All three are correct, and all three are
-- irrelevant to an attacker, because PostgREST is a public HTTP surface with
-- the same publishable key the browser already holds. `POST /rest/v1/predictions`
-- never runs a line of TypeScript. The only thing standing there is RLS, and
-- until this migration RLS had no opinion about kickoff or deadlines at all.
--
-- The precedent for fixing it this way is already in this schema:
-- `fan_ratings_insert_own` (0032) encodes "only after the whistle" as an EXISTS
-- against `fixtures.status` inside the policy itself, rather than trusting the
-- action. These policies now do the same for "only before kickoff".
--
-- Nothing here changes a single legitimate flow: every rule below is the rule
-- the corresponding server action already applied. What changes is that the
-- rule now also applies to callers who never went near the UI.

-- -----------------------------------------------------------------------------
-- 1. Predictions lock at kickoff — in the database, not just in the action
-- -----------------------------------------------------------------------------
-- SEVERITY: HIGH. The most direct exploit on the branch.
--
-- `predictions_insert_own` checked ownership and moderation status and nothing
-- else, so a signed-in caller could POST a prediction for a fixture that
-- finished last week and collect the points for it. With six prediction types
-- (0079) that is up to 24 points per already-played match, and correct_score —
-- the highest-value type at 6 — is the easiest one to be "right" about when you
-- are reading the scoreline off the fixture row as you write it.
--
-- `predictions_update_own_unlocked` looked stronger than it was. Its guard is
-- `locked_at is null`, and nothing populates `locked_at` until the admin
-- scoring pass runs — which only happens after full time, and only when an
-- admin presses the button. Between kickoff and that press, every pick in the
-- database was freely editable while the match was being played.
--
-- The real rule, matching submitPrediction exactly: the fixture must still be
-- scheduled AND kickoff must still be in the future. `locked_at is null` stays
-- as the second layer it was always meant to be.
drop policy if exists predictions_insert_own on predictions;
create policy predictions_insert_own on predictions
  for insert to authenticated
  with check (
    profile_id = private.current_profile_id()
    and not private.is_moderation_write_blocked()
    and exists (
      select 1 from fixtures f
      where f.id = predictions.fixture_id
        and f.status = 'scheduled'
        and f.kickoff_at > now()
    )
  );

-- USING decides which existing rows may be touched; WITH CHECK decides what the
-- row is allowed to become. Both need the gate: without it in USING a pick can
-- be rewritten after kickoff, and without it in WITH CHECK a pick can be moved
-- onto a fixture that has already started.
drop policy if exists predictions_update_own_unlocked on predictions;
create policy predictions_update_own_unlocked on predictions
  for update to authenticated
  using (
    profile_id = private.current_profile_id()
    and locked_at is null
    and exists (
      select 1 from fixtures f
      where f.id = predictions.fixture_id
        and f.status = 'scheduled'
        and f.kickoff_at > now()
    )
  )
  with check (
    profile_id = private.current_profile_id()
    and not private.is_moderation_write_blocked()
    and exists (
      select 1 from fixtures f
      where f.id = predictions.fixture_id
        and f.status = 'scheduled'
        and f.kickoff_at > now()
    )
  );

-- Deleting a pick after kickoff is not a way to gain points, but it is a way to
-- launder a record: delete every losing prediction before the scoring pass sees
-- it and your accuracy, your streak and your per-type breakdown all become
-- something that never happened. A prediction is a record of what someone said
-- before they knew, so it stops being erasable at the same moment it stops
-- being editable.
drop policy if exists predictions_delete_own_unlocked on predictions;
create policy predictions_delete_own_unlocked on predictions
  for delete to authenticated
  using (
    profile_id = private.current_profile_id()
    and locked_at is null
    and exists (
      select 1 from fixtures f
      where f.id = predictions.fixture_id
        and f.status = 'scheduled'
        and f.kickoff_at > now()
    )
  );

-- The admin scoring pass writes through the service-role client
-- (src/app/admin/data-health/predictions-actions.ts), which bypasses RLS
-- entirely, so none of the above can block a legitimate settlement.

-- -----------------------------------------------------------------------------
-- 2. The fantasy deadline, same story
-- -----------------------------------------------------------------------------
-- SUPERSEDED BY 0097 — read that before relying on anything in this section.
-- The three write policies created below were dropped hours later, once it was
-- clear that a per-row WITH CHECK closes "edit after kickoff" but cannot reach
-- the set-level squad rules (size, budget, formation, per-club cap). Roster
-- writes are now server-only. This section is kept as applied history, not as a
-- description of the current state. `fantasy_rosters_select_own`, created here,
-- IS still live and still doing real work.
-- SEVERITY: HIGH, and the exact analogue of the above. `fantasy_rosters_all_own`
-- was a single FOR ALL policy checking only team ownership, so a caller could
-- rewrite their squad — including the captain, who scores double — after the
-- deadline and, with an unscored gameweek, after the matches had been played.
--
-- Split by command rather than tightened in place, because reading your own
-- locked squad must keep working: the deadline restricts writing, not seeing.
drop policy if exists fantasy_rosters_all_own on fantasy_rosters;

create policy fantasy_rosters_select_own on fantasy_rosters
  for select to authenticated
  using (
    exists (
      select 1 from fantasy_teams t
      where t.id = fantasy_rosters.fantasy_team_id
        and t.owner_profile_id = private.current_profile_id()
    )
  );

create policy fantasy_rosters_insert_own_before_deadline on fantasy_rosters
  for insert to authenticated
  with check (
    exists (
      select 1 from fantasy_teams t
      where t.id = fantasy_rosters.fantasy_team_id
        and t.owner_profile_id = private.current_profile_id()
    )
    and exists (
      select 1 from fantasy_gameweeks g
      where g.id = fantasy_rosters.gameweek_id
        and g.deadline_at > now()
    )
  );

create policy fantasy_rosters_update_own_before_deadline on fantasy_rosters
  for update to authenticated
  using (
    exists (
      select 1 from fantasy_teams t
      where t.id = fantasy_rosters.fantasy_team_id
        and t.owner_profile_id = private.current_profile_id()
    )
    and exists (
      select 1 from fantasy_gameweeks g
      where g.id = fantasy_rosters.gameweek_id
        and g.deadline_at > now()
    )
  )
  with check (
    exists (
      select 1 from fantasy_teams t
      where t.id = fantasy_rosters.fantasy_team_id
        and t.owner_profile_id = private.current_profile_id()
    )
    and exists (
      select 1 from fantasy_gameweeks g
      where g.id = fantasy_rosters.gameweek_id
        and g.deadline_at > now()
    )
  );

create policy fantasy_rosters_delete_own_before_deadline on fantasy_rosters
  for delete to authenticated
  using (
    exists (
      select 1 from fantasy_teams t
      where t.id = fantasy_rosters.fantasy_team_id
        and t.owner_profile_id = private.current_profile_id()
    )
    and exists (
      select 1 from fantasy_gameweeks g
      where g.id = fantasy_rosters.gameweek_id
        and g.deadline_at > now()
    )
  );

-- The roster carry-forward in scoreFantasyGameweek writes through the
-- service-role client (src/app/admin/data-health/fantasy-actions.ts), so it is
-- unaffected — it must be able to write a roster for a gameweek whose deadline
-- has passed, which is precisely what everyone else is now stopped from doing.

-- -----------------------------------------------------------------------------
-- 3. An MOTM poll option must name a player who is actually in the match
-- -----------------------------------------------------------------------------
-- SEVERITY: MEDIUM, and self-inflicted — this is a hole in 0078, mine.
--
-- `poll_options_insert_own_post` checked that the caller owns the parent post
-- and stopped there, which was fine while an option was only ever a label. It
-- is not fine now that an option can carry a real `players.id`, because that id
-- is what settles other people's man-of-the-match predictions (0079). A caller
-- could seed the one MOTM poll a fixture is allowed with players who never
-- played, and every MOTM prediction on that match would then be resolved
-- against a candidate list KIVO invented on a stranger's behalf.
--
-- The rule is the one submitPrediction already applies to the prediction side:
-- a named player must be at one of the two clubs in KIVO's own squad data. A
-- null player_id stays allowed — that is an ordinary typed option, honestly not
-- a verified player.
drop policy if exists poll_options_insert_own_post on poll_options;
create policy poll_options_insert_own_post on poll_options
  for insert to authenticated
  with check (
    not private.is_moderation_write_blocked()
    and exists (
      select 1 from posts p
      where p.id = poll_options.post_id
        and p.author_profile_id = private.current_profile_id()
    )
    and (
      poll_options.player_id is null
      or exists (
        select 1
        from posts p
        join fixtures f on f.id = p.fixture_id
        join players pl on pl.id = poll_options.player_id
        where p.id = poll_options.post_id
          and pl.current_team_id in (f.home_team_id, f.away_team_id)
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 4. A suspended account should not be able to file reports
-- -----------------------------------------------------------------------------
-- SEVERITY: LOW-MEDIUM. Every other user-write policy in this schema carries
-- `not private.is_moderation_write_blocked()`; `reports_insert_own` was the one
-- that did not, so a suspended or banned account kept a working write path into
-- the moderation queue — the one table where a punished user has the clearest
-- motive to make noise.
--
-- Note the function only covers 'suspended' and 'banned'. A shadow-muted
-- account is deliberately still allowed to write here, because a write that
-- suddenly starts failing is exactly how a shadow mute stops being a shadow.
drop policy if exists reports_insert_own on reports;
create policy reports_insert_own on reports
  for insert to authenticated
  with check (
    reporter_profile_id = private.current_profile_id()
    and not private.is_moderation_write_blocked()
  );

-- -----------------------------------------------------------------------------
-- 5. A per-type breakdown is your own, like every other self-scoped aggregate
-- -----------------------------------------------------------------------------
-- SEVERITY: LOW, also mine (0079). `get_xp_total` and `get_activity_streak`
-- both take a p_profile_id and both refuse to answer for anyone but the caller
-- (`and p_profile_id = private.current_profile_id()`). This function took the
-- same argument and answered for anybody, which made it the one caller-widened
-- SECURITY DEFINER function on the branch.
--
-- Same signature, so `create or replace` keeps the existing grants rather than
-- dropping them; they are re-stated below regardless, because a recreated
-- function silently losing its grants has already happened here once.
create or replace function public.get_prediction_type_breakdown(p_profile_id uuid)
returns table (
  prediction_type      prediction_type,
  settled_count        bigint,
  correct_count        bigint,
  unresolvable_count   bigint,
  points               bigint
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    p.prediction_type,
    count(*) filter (where p.points_awarded is not null)::bigint as settled_count,
    count(*) filter (where p.points_awarded > 0)::bigint         as correct_count,
    count(*) filter (where p.resolution = 'unresolvable')::bigint as unresolvable_count,
    coalesce(sum(p.points_awarded) filter (where p.points_awarded is not null), 0)::bigint as points
  from predictions p
  where p.profile_id = p_profile_id
    and p_profile_id = private.current_profile_id()
  group by p.prediction_type;
$$;

revoke execute on function public.get_prediction_type_breakdown(uuid) from public;
revoke execute on function public.get_prediction_type_breakdown(uuid) from anon;
grant execute on function public.get_prediction_type_breakdown(uuid) to authenticated;

-- To reverse: recreate each policy above from its previous definition in
-- 0001 (predictions, fantasy_rosters, reports), 0032/0078 (poll_options), and
-- restore get_prediction_type_breakdown from 0079 without the self-scope line.
