-- =============================================================================
-- The season KIVO asks the provider for, as data the operator can change
-- =============================================================================
-- KIVO derives the season from the calendar: `currentProviderSeason()` returns
-- 2026 in August 2026, because API-Football numbers a season by its starting
-- year. That is correct arithmetic and it is currently the reason the platform
-- is empty.
--
-- The provider's own words, recorded in `sync_runs.error_message` on this
-- database at 19:12 on 2026-08-19:
--
--   "API-Football refused the request (plan): Free plans do not have access to
--    this season, try from 2022 to 2024."
--
-- Every season-scoped endpoint is therefore refused outright on the account
-- this deployment runs against — standings, `/teams?league=&season=`,
-- `/leagues?season=`, injuries, top scorers, player season statistics. The
-- endpoints that carry no season parameter (`/fixtures?date=`,
-- `/players/squads?team=`, `/coachs?team=`, `/fixtures/lineups|events|
-- statistics|players?fixture=`, `/transfers?player=|team=`) are unaffected and
-- work today; 705 teams and 354 fixtures on this database came from one of
-- them.
--
-- So the fix is not a code change. It is a number, and it has to be settable
-- without a deploy: point KIVO at 2024 and the whole platform works on the free
-- plan; flip it back the day the plan is upgraded.
--
-- -----------------------------------------------------------------------------
-- Why the default is still the real current season
-- -----------------------------------------------------------------------------
-- An empty table means the calendar answer applies, exactly as before. KIVO
-- must never quietly show a two-year-old season: a fan reading a standings
-- table has no way to tell 2024 from 2026 unless something says so. Overriding
-- is a deliberate act that leaves a row, a reason and a timestamp, and every
-- surface that reads the target season is expected to say which year it got and
-- where the year came from.
--
-- -----------------------------------------------------------------------------
-- Precedence
-- -----------------------------------------------------------------------------
--   1. a row here                 -> the operator's choice
--   2. FOOTBALL_TARGET_SEASON     -> the environment variable
--   3. currentProviderSeason()    -> the calendar
--
-- A failed read falls through to 2 and then 3 and logs, the same posture
-- `competition_scope` (migration 0114) takes: a transient database error must
-- not silently change which season the pipeline syncs.
--
-- -----------------------------------------------------------------------------
-- Publicly readable, service-role writable
-- -----------------------------------------------------------------------------
-- Which season KIVO is showing is not a secret — it is the single most
-- important thing a reader needs to know about the numbers on screen, and
-- hiding it behind an admin boundary is how "these standings are from 2024"
-- fails to reach the person looking at them. Writes have no policy at all, so
-- they are service-role only, exactly like `competition_scope`.

create table if not exists provider_season_target (
  provider    text primary key,
  -- The season's starting year in the provider's own numbering: 2024 means the
  -- 2024/25 season. Not a KIVO convention — it is how API-Football keys every
  -- season-scoped endpoint.
  season_year integer not null,
  -- Why this override exists, in the operator's words. Rendered next to the
  -- year wherever the override is shown, so nobody two months from now has to
  -- guess whether 2024 was a plan limitation or a mistake.
  reason      text,
  set_by      uuid references profiles(id) on delete set null,
  updated_at  timestamptz not null default now(),
  constraint provider_season_target_provider_not_blank check (length(btrim(provider)) > 0),
  -- A range wide enough for any real football season and narrow enough that a
  -- fat-fingered 20244 fails the write rather than silently syncing nothing.
  constraint provider_season_target_year_plausible check (season_year between 1888 and 2100)
);

comment on table provider_season_target is
  'Operator-chosen season year each provider is asked for. One row per provider; an empty table means the calendar-derived current season applies, never "no season". Exists because a free API-Football plan refuses every season-scoped endpoint for the current season, so the whole platform can be pointed at a covered year without a deploy.';

comment on column provider_season_target.season_year is
  'The season''s STARTING year in the provider''s numbering (2024 = the 2024/25 season). Every surface that reads it is expected to state the year and that it is an override — a fan cannot tell 2024 from 2026 by looking at a table.';

comment on column provider_season_target.reason is
  'Free text from whoever set it. Shown beside the year so the override stays legible after the person who set it has moved on.';

alter table provider_season_target enable row level security;

-- Read: everyone. Which season is on screen is exactly what a reader needs in
-- order to trust (or distrust) what they are reading.
drop policy if exists provider_season_target_select_public on provider_season_target;
create policy provider_season_target_select_public on provider_season_target
  for select to anon, authenticated
  using (true);

comment on policy provider_season_target_select_public on provider_season_target is
  'Public read. The override changes what every standings table and squad on the site means, so it must be readable by the same clients that render them. No insert/update/delete policy exists, so writes are service-role only.';

-- To reverse:
--   drop policy if exists provider_season_target_select_public on provider_season_target;
--   drop table if exists provider_season_target;
