-- =============================================================================
-- KN-84 and KN-85 — the matchday number, and standings that remember
-- =============================================================================
-- Batched because they are the same story from two ends: KIVO throws away the
-- competition's own sense of *when* a fixture happened (which matchday) and of
-- *what the table looked like* at any point before now.


-- =============================================================================
-- KN-84. `fixtures.matchday` is written by nothing
-- =============================================================================
-- The item calls it "synced and never used". Reading the code, the first half
-- was not true either: the column has existed since migration 0001, with a doc
-- comment promising a "round/gameweek number within the competition", and
-- nothing has ever written to it. No normalizer read the provider's round, and
-- this function did not carry it. It was a column, a comment and an intention.
--
-- `p_matchday` is appended as the last parameter with a default, so every
-- existing caller keeps compiling and keeps behaving identically.
--
-- The important half of this is in TypeScript, not here: `parseMatchday`
-- (src/lib/football/matchday.ts) reads a number out of a provider's free-text
-- round label ("Regular Season - 12") and returns **null** for anything without
-- one ("Quarter-finals", "Round of 16" — where 16 is a count of teams, not a
-- matchday). A cup fixture has no numbered matchday, and inventing one would
-- give every consumer downstream an ordering the competition does not have.

-- DESTRUCTIVE, and deliberately so — stated plainly because this runs against a
-- live project. Adding a parameter to a function does NOT replace it: Postgres
-- treats the new arity as a distinct overload, so a bare `create or replace`
-- leaves the old 14-argument version in place beside the new 15-argument one.
-- That is not merely untidy, it is broken: a call that omits the optional
-- arguments then matches both candidates and fails with "function ... is not
-- unique" — which is exactly what the verification run hit before this drop
-- was added.
--
-- Risk assessment: the only caller of this function anywhere is
-- `upsertFixture` in src/lib/football/sync.ts, which is updated in the same
-- change to pass `p_matchday`. Nothing else in the repository or the database
-- references the 14-argument form (checked by grep and by pg_proc), and the
-- new form is a strict superset with a defaulted parameter, so no caller loses
-- a capability. The drop is guarded by IF EXISTS so re-applying is safe.
drop function if exists public.upsert_fixture_with_mapping(
  text, text, uuid, uuid, uuid, uuid, fixture_status, timestamptz,
  uuid, smallint, smallint, smallint, smallint, smallint
);

create or replace function public.upsert_fixture_with_mapping(
  p_provider text,
  p_provider_entity_id text,
  p_competition_id uuid,
  p_season_id uuid,
  p_home_team_id uuid,
  p_away_team_id uuid,
  p_status fixture_status,
  p_kickoff_at timestamptz,
  p_venue_id uuid default null,
  p_home_score smallint default null,
  p_away_score smallint default null,
  p_home_score_ht smallint default null,
  p_away_score_ht smallint default null,
  p_minute_elapsed smallint default null,
  p_matchday smallint default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  select kivo_entity_id into v_id
  from provider_mappings
  where provider = p_provider and entity_type = 'fixture' and provider_entity_id = p_provider_entity_id;

  if found then
    update fixtures
    set competition_id = p_competition_id,
        season_id = p_season_id,
        home_team_id = p_home_team_id,
        away_team_id = p_away_team_id,
        venue_id = p_venue_id,
        status = p_status,
        kickoff_at = p_kickoff_at,
        home_score = p_home_score,
        away_score = p_away_score,
        home_score_ht = p_home_score_ht,
        away_score_ht = p_away_score_ht,
        minute_elapsed = p_minute_elapsed,
        -- Never clobber a known matchday with a null. A provider response that
        -- omits the round (or a round label this release cannot parse) must not
        -- erase a number an earlier sync legitimately established — the same
        -- never-overwrite-with-null rule upsertTeam and upsertPlayer already
        -- apply to crests and photos.
        matchday = coalesce(p_matchday, fixtures.matchday)
    where id = v_id;
    return v_id;
  end if;

  insert into fixtures (
    competition_id, season_id, home_team_id, away_team_id, venue_id,
    status, kickoff_at, home_score, away_score, home_score_ht, away_score_ht,
    minute_elapsed, matchday
  )
  values (
    p_competition_id, p_season_id, p_home_team_id, p_away_team_id, p_venue_id,
    p_status, p_kickoff_at, p_home_score, p_away_score, p_home_score_ht, p_away_score_ht,
    p_minute_elapsed, p_matchday
  )
  returning id into v_id;

  begin
    insert into provider_mappings (provider, entity_type, provider_entity_id, kivo_entity_id)
    values (p_provider, 'fixture', p_provider_entity_id, v_id);
  exception when unique_violation then
    delete from fixtures where id = v_id;
    select kivo_entity_id into v_id
    from provider_mappings
    where provider = p_provider and entity_type = 'fixture' and provider_entity_id = p_provider_entity_id;
  end;

  return v_id;
end;
$$;

-- A matchday navigator and a "gameweek N results" view both filter on exactly
-- this shape, and neither existing fixtures index covers it.
create index if not exists idx_fixtures_competition_matchday
  on fixtures (competition_id, matchday)
  where matchday is not null;


-- =============================================================================
-- KN-85. Standings are overwritten in place, so the table has no memory
-- =============================================================================
-- `syncStandings` upserts on `(season_id, team_id)`. Every refresh destroys
-- what the table said before it, which forecloses more than movement arrows:
-- there is no position-over-time chart, no honest "biggest riser this month",
-- and no audit trail when a provider silently corrects a table.
--
-- RECOMMENDATIONS item 242 proposes a `previous_position` column. Append-only
-- snapshots are barely more expensive and strictly larger in payoff — and,
-- unlike a `previous_position` column, they cannot fabricate a prior value on
-- the very first sync. A team with one snapshot has no movement, and that is
-- representable here (one row) in a way a NOT NULL previous position is not.
--
-- Sized honestly: one row per team per *changed* refresh. A 20-team league
-- refreshed daily for a season is ~7,000 rows. That is nothing, and the write
-- is skipped entirely when nothing changed (see `record_standings_snapshot`),
-- so a league refreshed hourly between matchdays does not grow at all.

create table if not exists standings_snapshots (
  id             uuid primary key default gen_random_uuid(),
  season_id      uuid not null references seasons (id) on delete cascade,
  team_id        uuid not null references teams (id) on delete cascade,
  captured_at    timestamptz not null default now(),
  position       smallint,
  played         integer not null,
  won            integer not null,
  drawn          integer not null,
  lost           integer not null,
  goals_for      integer not null,
  goals_against  integer not null,
  points         integer not null,
  constraint standings_snapshots_counts_non_negative check (
    played >= 0 and won >= 0 and drawn >= 0 and lost >= 0
    and goals_for >= 0 and goals_against >= 0
  )
);

comment on table standings_snapshots is
  'Append-only history of what a league table said, one row per team per changed refresh (KN-85). Never updated or deleted by the pipeline: a corrected table produces a new row, and the old row stays as the record of what KIVO showed at the time.';

create index if not exists idx_standings_snapshots_season_captured
  on standings_snapshots (season_id, captured_at desc);
create index if not exists idx_standings_snapshots_team
  on standings_snapshots (team_id, captured_at desc);

alter table standings_snapshots enable row level security;

-- Public read, same as `standings` itself: this is football reference data, and
-- a position-over-time chart on a team page is for everyone. Writes are
-- service-role only, like every other row in the football pipeline.
create policy standings_snapshots_select_public on standings_snapshots
  for select to authenticated, anon
  using (true);

/**
 * Records a snapshot for one team, but only when something actually changed
 * since that team's last one.
 *
 * The skip is what makes append-only affordable. Standings are refreshed on a
 * schedule, not on matchdays, so most refreshes find an identical table — and
 * a row per team per refresh regardless would be almost entirely duplicates,
 * which would then make "when did this change" harder to answer, not easier.
 *
 * Returns whether a row was written, so the caller can report a real count.
 */
create or replace function public.record_standings_snapshot(
  p_season_id uuid,
  p_team_id uuid,
  p_position smallint,
  p_played integer,
  p_won integer,
  p_drawn integer,
  p_lost integer,
  p_goals_for integer,
  p_goals_against integer,
  p_points integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_latest standings_snapshots%rowtype;
begin
  select * into v_latest
  from standings_snapshots
  where season_id = p_season_id and team_id = p_team_id
  order by captured_at desc
  limit 1;

  if found
     and v_latest.position is not distinct from p_position
     and v_latest.played = p_played
     and v_latest.won = p_won
     and v_latest.drawn = p_drawn
     and v_latest.lost = p_lost
     and v_latest.goals_for = p_goals_for
     and v_latest.goals_against = p_goals_against
     and v_latest.points = p_points
  then
    return false;
  end if;

  insert into standings_snapshots (
    season_id, team_id, position, played, won, drawn, lost, goals_for, goals_against, points
  )
  values (
    p_season_id, p_team_id, p_position, p_played, p_won, p_drawn, p_lost, p_goals_for, p_goals_against, p_points
  );

  return true;
end;
$$;

revoke execute on function public.record_standings_snapshot(uuid, uuid, smallint, integer, integer, integer, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.record_standings_snapshot(uuid, uuid, smallint, integer, integer, integer, integer, integer, integer, integer)
  to service_role;

/**
 * One team's position over time, for a real chart on a team page.
 *
 * `SECURITY INVOKER` — the table's own public-select policy is the access rule,
 * not a re-implementation of it inside a definer function.
 *
 * Returns only what was actually recorded. A season with one snapshot returns
 * one point, and the UI is expected to say "not enough history yet" rather than
 * draw a line between a point and nothing.
 */
create or replace function public.get_team_position_history(
  p_season_id uuid,
  p_team_id uuid,
  p_limit integer default 60
)
returns table (
  captured_at  timestamptz,
  -- Quoted: `position` is a reserved word in a RETURNS TABLE column list, and
  -- Postgres rejects it bare. Kept as the name anyway so the RPC's shape
  -- matches `standings.position` rather than inventing a synonym.
  "position"   smallint,
  points       integer,
  played       integer
)
language sql
security invoker
set search_path = public, pg_temp
stable
as $$
  select captured_at, position, points, played
  from standings_snapshots
  where season_id = p_season_id and team_id = p_team_id
  order by captured_at desc
  limit greatest(coalesce(p_limit, 60), 1);
$$;

revoke execute on function public.get_team_position_history(uuid, uuid, integer) from public;
grant execute on function public.get_team_position_history(uuid, uuid, integer) to anon, authenticated, service_role;

/**
 * Real movement between the newest snapshot and the newest one at least
 * `p_since` old — the honest version of item 242's arrows.
 *
 * Honest in a specific way: a team with no earlier snapshot returns
 * `previous_position` null, and the UI must render no arrow at all rather than
 * a flat one. "We have not been watching long enough to know" and "it has not
 * moved" are different facts, and a `previous_position` column could not have
 * told them apart on a first sync.
 */
create or replace function public.get_standings_movement(
  p_season_id uuid,
  p_since interval default interval '7 days'
)
returns table (
  team_id           uuid,
  current_position  smallint,
  previous_position smallint,
  current_points    integer,
  previous_points   integer
)
language sql
security invoker
set search_path = public, pg_temp
stable
as $$
  with latest as (
    select distinct on (team_id) team_id, position, points, captured_at
    from standings_snapshots
    where season_id = p_season_id
    order by team_id, captured_at desc
  ),
  earlier as (
    select distinct on (team_id) team_id, position, points
    from standings_snapshots
    where season_id = p_season_id
      and captured_at <= now() - coalesce(p_since, interval '7 days')
    order by team_id, captured_at desc
  )
  select
    latest.team_id,
    latest.position,
    earlier.position,
    latest.points,
    earlier.points
  from latest
  left join earlier on earlier.team_id = latest.team_id;
$$;

revoke execute on function public.get_standings_movement(uuid, interval) from public;
grant execute on function public.get_standings_movement(uuid, interval) to anon, authenticated, service_role;


-- To reverse:
--   drop function if exists public.get_standings_movement(uuid, interval);
--   drop function if exists public.get_team_position_history(uuid, uuid, integer);
--   drop function if exists public.record_standings_snapshot(uuid, uuid, smallint, integer, integer, integer, integer, integer, integer, integer);
--   drop table if exists standings_snapshots;
--   drop index if exists idx_fixtures_competition_matchday;
--   -- and re-create upsert_fixture_with_mapping without p_matchday (see 0018).
