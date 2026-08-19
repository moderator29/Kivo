-- =============================================================================
-- 0083 — Injuries, scoring charts, and player season statistics
-- =============================================================================
-- Three API-Football endpoints the founder's key already pays for and KIVO has
-- never called. Batched because they share one shape (competition-scoped
-- reference data about players) and one rule (a provider id KIVO cannot resolve
-- is kept, not dropped).
--
-- A NOTE ON WHETHER THESE WILL RETURN ANYTHING
-- --------------------------------------------
-- docs/API_FOOTBALL.md records injuries as unavailable on the free tier, and
-- this build environment cannot reach api-football.com to check whether that is
-- still true. That uncertainty is not resolved by guessing — it is resolved by
-- the coverage registry (migration 0082), which is the provider's own statement
-- about exactly this, per competition. The sync for each of these asks the
-- registry first and skips when the answer is a definite no, so a plan that
-- genuinely cannot serve one of these never spends the same request twice
-- learning that. Where the registry says "unknown", the sync attempts it once
-- and records what came back.


-- -----------------------------------------------------------------------------
-- 1. injuries
-- -----------------------------------------------------------------------------
-- A statement about a named person's fitness, which is why every honesty rule in
-- this codebase applies to it more sharply than usual:
--
--   * `status` has an explicit 'unknown' value, and the normalizer returns it
--     rather than defaulting an unparseable provider string to 'out'. Telling a
--     fan a player is ruled out because KIVO could not read a string would be a
--     confident, specific, wrong claim about a real person.
--   * `reason` is the provider's free text, stored verbatim and never bucketed.
--     Bucketing a medical description is an inference nobody asked for.
--   * There is no "expected return" column. The provider publishes none, and it
--     is the single most tempting field to estimate.
create table if not exists injuries (
  id              uuid primary key default gen_random_uuid(),
  player_id       uuid not null references players (id) on delete cascade,
  team_id         uuid references teams (id) on delete set null,
  -- The fixture the provider attached the report to, when it attached one.
  fixture_id      uuid references fixtures (id) on delete set null,
  competition_id  uuid references competitions (id) on delete set null,
  season_id       uuid references seasons (id) on delete set null,
  status          text not null,
  reason          text,
  -- Taken from the fixture the report is attached to. Null when the provider
  -- dates nothing — never filled with the sync's own clock, which would date
  -- every report to whenever KIVO happened to look.
  reported_on     date,
  provider        text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint injuries_status_known check (status in ('out', 'doubtful', 'unknown'))
);

comment on table injuries is
  'Provider-reported player unavailability. `status` carries a real ''unknown'' value for a provider string KIVO could not parse — an unreadable report is never defaulted to ''out''. `reason` is the provider''s own free text, verbatim. There is deliberately no expected-return column: the provider publishes none and estimating one would be a claim about a person''s recovery.';

create trigger trg_injuries_updated_at before update on injuries
  for each row execute function set_updated_at();

create index if not exists idx_injuries_player on injuries (player_id);
create index if not exists idx_injuries_team on injuries (team_id);
create index if not exists idx_injuries_competition_season on injuries (competition_id, season_id);

alter table injuries enable row level security;

create policy injuries_select_public on injuries
  for select to authenticated using (true);
create policy injuries_insert_admin on injuries
  for insert to authenticated
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));
create policy injuries_update_admin on injuries
  for update to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']))
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));
create policy injuries_delete_admin on injuries
  for delete to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']));


-- -----------------------------------------------------------------------------
-- 2. top_scorers
-- -----------------------------------------------------------------------------
-- `rank` is stored rather than recomputed. The provider applies the
-- competition's own tie-breaks; re-sorting on goals in SQL or JavaScript would
-- quietly substitute a different competition's rules for this one's, and the
-- reader would have no way to tell.
--
-- Scoped by season_id (which already carries the competition through its own FK)
-- plus competition_id, denormalized for the obvious query. One row per player
-- per season: a re-sync updates in place rather than appending, because this is
-- a current standing, not a history. Standings history has its own table
-- (`standings_snapshots`) and this deliberately does not imitate it — nobody has
-- asked for a scoring chart over time, and appending on every sync would grow
-- without bound for a surface that only ever shows "now".
create table if not exists top_scorers (
  id                 uuid primary key default gen_random_uuid(),
  season_id          uuid not null references seasons (id) on delete cascade,
  competition_id     uuid not null references competitions (id) on delete cascade,
  player_id          uuid not null references players (id) on delete cascade,
  team_id            uuid references teams (id) on delete set null,
  rank               smallint not null,
  goals              smallint,
  assists            smallint,
  penalties_scored   smallint,
  appearances        smallint,
  minutes_played     integer,
  captured_at        timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint top_scorers_unique_season_player unique (season_id, player_id),
  constraint top_scorers_rank_positive check (rank >= 1)
);

comment on table top_scorers is
  'A competition''s scoring chart as the provider ranks it. `rank` is the provider''s own ordering, stored rather than recomputed, so the competition''s real tie-breaks survive. One row per player per season, updated in place — this is a current standing, not a history.';

create trigger trg_top_scorers_updated_at before update on top_scorers
  for each row execute function set_updated_at();

create index if not exists idx_top_scorers_season_rank on top_scorers (season_id, rank);
create index if not exists idx_top_scorers_competition on top_scorers (competition_id);
create index if not exists idx_top_scorers_player on top_scorers (player_id);
create index if not exists idx_top_scorers_team on top_scorers (team_id);

alter table top_scorers enable row level security;

create policy top_scorers_select_public on top_scorers
  for select to authenticated using (true);
create policy top_scorers_insert_admin on top_scorers
  for insert to authenticated
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));
create policy top_scorers_update_admin on top_scorers
  for update to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']))
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));
create policy top_scorers_delete_admin on top_scorers
  for delete to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']));


-- -----------------------------------------------------------------------------
-- 3. player_season_statistics
-- -----------------------------------------------------------------------------
-- The largest single data unlock available on this API: one row per player per
-- competition per season is what makes a career breakdown, a competition split,
-- a radar chart and a fantasy price grounded in real output possible at all.
--
-- ONE ROW PER COMPETITION, NEVER SUMMED. Summing is lossy and irreversible:
-- "14 goals" cannot be turned back into "11 in the league, 3 in the cup", and
-- the split is the entire point. Anything that wants a total adds these up.
--
-- competition_id and team_id are NULLABLE with the provider's own id kept
-- alongside, for the same reason transfers does it: a player's season legitimately
-- includes competitions and clubs KIVO has never synced, and dropping those rows
-- would silently under-report a career while looking complete. The uniqueness key
-- is therefore on the provider's ids, which are always present, rather than on the
-- KIVO ids, which are not.
create table if not exists player_season_statistics (
  id                        uuid primary key default gen_random_uuid(),
  provider                  text not null,
  player_id                 uuid not null references players (id) on delete cascade,
  provider_competition_id   text not null,
  competition_id            uuid references competitions (id) on delete set null,
  competition_name          text,
  season_year               smallint not null,
  season_id                 uuid references seasons (id) on delete set null,
  provider_team_id          text,
  team_id                   uuid references teams (id) on delete set null,
  team_name                 text,
  position                  text,
  appearances               smallint,
  lineups                   smallint,
  minutes_played            integer,
  provider_rating           numeric(4, 2),
  goals                     smallint,
  assists                   smallint,
  goals_conceded            smallint,
  saves                     smallint,
  shots_total               smallint,
  shots_on_target           smallint,
  passes_total              integer,
  passes_key                smallint,
  pass_accuracy             smallint,
  tackles_total             smallint,
  blocks                    smallint,
  interceptions             smallint,
  duels_total               integer,
  duels_won                 integer,
  dribbles_attempted        smallint,
  dribbles_succeeded        smallint,
  fouls_drawn               smallint,
  fouls_committed           smallint,
  yellow_cards              smallint,
  red_cards                 smallint,
  penalties_scored          smallint,
  penalties_missed          smallint,
  retrieved_at              timestamptz not null default now(),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint player_season_statistics_unique_scope
    unique (provider, player_id, provider_competition_id, season_year),
  constraint player_season_statistics_season_sane
    check (season_year >= 1900 and season_year <= 2200),
  constraint player_season_statistics_rating_sane
    check (provider_rating is null or (provider_rating >= 0 and provider_rating <= 10)),
  constraint player_season_statistics_accuracy_sane
    check (pass_accuracy is null or (pass_accuracy >= 0 and pass_accuracy <= 100))
);

comment on table player_season_statistics is
  'One player''s aggregate output for one competition in one season. Never summed across competitions — the split is what makes a career breakdown possible, and summing cannot be undone. competition_id/team_id are nullable with the provider''s ids kept, so a season spent partly in a competition KIVO has not synced is still recorded in full rather than silently under-reported.';

create trigger trg_player_season_statistics_updated_at before update on player_season_statistics
  for each row execute function set_updated_at();

create index if not exists idx_player_season_statistics_player_season
  on player_season_statistics (player_id, season_year desc);
create index if not exists idx_player_season_statistics_competition
  on player_season_statistics (competition_id, season_year);
create index if not exists idx_player_season_statistics_team on player_season_statistics (team_id);
create index if not exists idx_player_season_statistics_season on player_season_statistics (season_id);
create index if not exists idx_player_season_statistics_unresolved
  on player_season_statistics (provider, provider_competition_id)
  where competition_id is null;

alter table player_season_statistics enable row level security;

create policy player_season_statistics_select_public on player_season_statistics
  for select to authenticated using (true);
create policy player_season_statistics_insert_admin on player_season_statistics
  for insert to authenticated
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));
create policy player_season_statistics_update_admin on player_season_statistics
  for update to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']))
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));
create policy player_season_statistics_delete_admin on player_season_statistics
  for delete to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']));

-- To reverse:
--   drop table if exists player_season_statistics;
--   drop table if exists top_scorers;
--   drop table if exists injuries;
