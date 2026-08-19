-- =============================================================================
-- 0081 — The heatmap engine's real inputs, and its cache
-- =============================================================================
-- Three things, one story: give the heatmap engine something real to be built
-- from, record the one genuinely positional field the provider publishes, and
-- stop recomputing the result.
--
--   1. lineups.grid                 the team sheet's own formation slot
--   2. fixture_player_statistics    per-player, per-match counts
--   3. player_heatmaps              the generated grid, cached
--
-- WHAT THIS SCHEMA DOES NOT CLAIM
-- -------------------------------
-- Nothing here stores a pitch coordinate for an action, because API-Football
-- publishes none — not on the free tier and not on any tier. A fixture event
-- carries a minute, a team, a player, a type and a detail; per-player
-- statistics carry counts. That was established from the committed adapter
-- rather than a live call, because this build environment cannot reach
-- api-football.com. `player_heatmaps.derivation` exists precisely so a row
-- built by inference can never be mistaken for a row built by measurement.


-- -----------------------------------------------------------------------------
-- 1. lineups.grid — the formation slot
-- -----------------------------------------------------------------------------
-- API-Football returns this on every starter in /fixtures/lineups as "row:col"
-- (row 1 is the goalkeeper's line, rows count upfield). It is the closest thing
-- to positional data the provider has, and it arrives free on a request KIVO
-- already makes for the lineup itself — the same reasoning that had `photo`
-- mapped through on squads.
--
-- Stored as the provider's raw text rather than two integers: the row/column
-- semantics are a provider quirk, parsing belongs in the normalizer that owns
-- that quirk (parsePitchGrid), and a raw string keeps a differently-shaped
-- future value readable instead of rejected.
alter table lineups add column if not exists grid text;

comment on column lineups.grid is
  'The provider''s own formation slot for this player, raw, as "row:col" (row 1 = goalkeeper''s line, counting upfield). Null for every substitute and whenever the provider omits it. A statement about where a player LINED UP, never about where they went — anything derived from it must be labelled as derived.';


-- -----------------------------------------------------------------------------
-- 2. lineups.pitch_heatmap is dropped
-- -----------------------------------------------------------------------------
-- Added by 0036 as readiness plumbing for a paid vendor, shaped after that
-- vendor's payload, and deliberately left alone by 0039 with a note saying the
-- call belonged to whoever finished the heatmap engine. This is that work, so
-- this is that call.
--
-- It goes for a concrete reason rather than tidiness: `lineups` is one row per
-- (fixture, team, player), and a heatmap needs a period dimension — a first-half
-- shape and a second-half shape are different answers for the same player in the
-- same match — plus the derivation tag that makes the whole feature honest. A
-- jsonb blob on the wrong grain would have had to encode both, badly, and the
-- first thing to go would have been the tag.
--
-- Zero rows are lost: the column has been null on every row since it was added,
-- and nothing in the codebase has ever read or written it (checked by grep
-- across src/ and supabase/ immediately before writing this).
alter table lineups drop column if exists pitch_heatmap;


-- -----------------------------------------------------------------------------
-- 3. fixture_player_statistics
-- -----------------------------------------------------------------------------
-- One row per (fixture, player). The grain matters: this is the player's own
-- line in the match, and it is what makes the heatmap's event basis richer than
-- goals-and-cards, what gives KIVO real minutes played, and what a Player
-- Ratings surface would read.
--
-- EVERY numeric column is nullable, and null means "the provider did not report
-- this", never zero. A midfielder with tackles null is one KIVO knows nothing
-- about; one with tackles 0 made none. Merging those two would let a heatmap
-- treat ignorance as a fact about a player, which is the specific failure this
-- whole engine is designed not to commit.
create table if not exists fixture_player_statistics (
  id                    uuid primary key default gen_random_uuid(),
  fixture_id            uuid not null references fixtures (id) on delete cascade,
  player_id             uuid not null references players (id) on delete cascade,
  team_id               uuid not null references teams (id) on delete cascade,
  minutes_played        smallint,
  -- The provider's coarse deployment code for this match (G/D/M/F). Free text,
  -- same convention as players.position: providers report buckets, not a taxonomy.
  position              text,
  is_substitute         boolean,
  -- The PROVIDER's rating. KIVO's rating-engine.ts computes its own, separately,
  -- and the two are never mixed or averaged — this column holds one opinion and
  -- says whose it is.
  provider_rating       numeric(4, 2),
  shots_total           smallint,
  shots_on_target       smallint,
  goals                 smallint,
  assists               smallint,
  goals_conceded        smallint,
  saves                 smallint,
  passes_total          smallint,
  passes_key            smallint,
  pass_accuracy         smallint,
  tackles_total         smallint,
  blocks                smallint,
  interceptions         smallint,
  duels_total           smallint,
  duels_won             smallint,
  dribbles_attempted    smallint,
  dribbles_succeeded    smallint,
  dribbled_past         smallint,
  fouls_drawn           smallint,
  fouls_committed       smallint,
  yellow_cards          smallint,
  red_cards             smallint,
  offsides              smallint,
  penalties_won         smallint,
  penalties_committed   smallint,
  penalties_scored      smallint,
  penalties_missed      smallint,
  penalties_saved       smallint,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint fixture_player_statistics_unique_fixture_player unique (fixture_id, player_id),
  -- Bounds, not business rules. A negative count or a 300-minute appearance is a
  -- corrupt read, and it should fail at the write rather than be rendered.
  constraint fixture_player_statistics_minutes_sane
    check (minutes_played is null or (minutes_played >= 0 and minutes_played <= 200)),
  constraint fixture_player_statistics_rating_sane
    check (provider_rating is null or (provider_rating >= 0 and provider_rating <= 10)),
  constraint fixture_player_statistics_accuracy_sane
    check (pass_accuracy is null or (pass_accuracy >= 0 and pass_accuracy <= 100))
);

comment on table fixture_player_statistics is
  'One player''s own numbers for one fixture, from the provider''s per-fixture player-statistics endpoint. COUNTS ONLY — there is no coordinate anywhere in this table because the provider publishes none. Every numeric column nullable, where null means "not reported" and is never to be rendered or computed as zero.';

create trigger trg_fixture_player_statistics_updated_at before update on fixture_player_statistics
  for each row execute function set_updated_at();

create index if not exists idx_fixture_player_statistics_fixture on fixture_player_statistics (fixture_id);
create index if not exists idx_fixture_player_statistics_player on fixture_player_statistics (player_id);
create index if not exists idx_fixture_player_statistics_team on fixture_player_statistics (team_id);

alter table fixture_player_statistics enable row level security;

-- Read: signed-in only, matching every other football reference table after
-- 0059 closed the anon surface. Writes: the football data pipeline's admin
-- roles, same as fixtures/lineups/fixture_events. The service-role key used by
-- the sync worker bypasses RLS entirely, as it does everywhere else.
create policy fixture_player_statistics_select_public on fixture_player_statistics
  for select to authenticated using (true);
create policy fixture_player_statistics_insert_admin on fixture_player_statistics
  for insert to authenticated
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));
create policy fixture_player_statistics_update_admin on fixture_player_statistics
  for update to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']))
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));
create policy fixture_player_statistics_delete_admin on fixture_player_statistics
  for delete to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']));


-- -----------------------------------------------------------------------------
-- 4. player_heatmaps — the cache
-- -----------------------------------------------------------------------------
-- The founder's spec asks for generated heatmaps to be cached so KIVO does not
-- repeatedly spend API requests. Two different costs are being avoided:
--
--   * the provider request that fetches the per-player statistics, and
--   * the aggregation itself, which is a Gaussian sum over every zone for every
--     player and is not free on a phone.
--
-- Grain is (fixture, player, period). Period is part of the key because a
-- first-half shape and a second-half shape are genuinely different answers, and
-- a cache keyed without it would serve one as the other.
create table if not exists player_heatmaps (
  id                     uuid primary key default gen_random_uuid(),
  fixture_id             uuid not null references fixtures (id) on delete cascade,
  player_id              uuid not null references players (id) on delete cascade,
  team_id                uuid not null references teams (id) on delete cascade,
  period                 text not null,
  -- The honesty hinge, in the schema rather than in the UI layer. 'tracked'
  -- means real provider coordinates; 'derived' means an inference from the team
  -- sheet's formation slot and counted actions. Nothing today can write
  -- 'tracked' — no PositionalDataProvider is implemented — and a consumer that
  -- renders a row without reading this column is rendering an inference as a
  -- measurement.
  derivation             text not null,
  -- { cols, rows, maxZoneWeight, zones: [{ col, row, weight, density }] } in the
  -- canonical 0-100 x 0-100 pitch space (src/lib/football/heatmap/
  -- pitch-coordinates.ts), NOT in the SVG render space — so changing the pitch
  -- graphic can never silently change what a stored grid means.
  grid                   jsonb not null,
  -- The real, integer count of real actions behind the grid. This is the only
  -- volume number a UI may show; per-zone weights on the derived path are in
  -- arbitrary units with no meaning outside their own grid.
  total_actions          integer not null default 0,
  -- Actions the period filter had to drop for having no period at all (match
  -- totals belong to no half). Non-zero means a half view is narrower than the
  -- data KIVO holds, and the UI is expected to say so.
  actions_without_period integer not null default 0,
  -- [{ actionClass, weight }], descending — lets a caption say what the shape is
  -- made of instead of asserting a shape with no stated basis.
  class_mix              jsonb not null default '[]'::jsonb,
  -- What the anchor was and how confident it is, or null when the player could
  -- not be anchored at all. Stored rather than recomputed so the caption and the
  -- grid can never drift apart.
  anchor                 jsonb,
  sources                text[] not null default '{}'::text[],
  -- Bumped whenever the derivation model changes. Every row from an older
  -- version is ignored and regenerated, so a model change can never leave stale
  -- shapes on screen that nobody can explain.
  engine_version         smallint not null,
  -- A digest of the inputs this row was built from. The cache is invalidated by
  -- the inputs changing, not by a clock: a fixture that finished last season is
  -- as valid today as it was then, and a live fixture's shape must not be served
  -- from before its last two goals.
  inputs_fingerprint     text not null,
  generated_at           timestamptz not null default now(),
  constraint player_heatmaps_unique_scope unique (fixture_id, player_id, period),
  constraint player_heatmaps_period_known
    check (period in ('full-match', 'first-half', 'second-half', 'extra-time')),
  constraint player_heatmaps_derivation_known
    check (derivation in ('tracked', 'derived')),
  constraint player_heatmaps_total_actions_non_negative
    check (total_actions >= 0 and actions_without_period >= 0)
);

comment on table player_heatmaps is
  'Cached output of the KIVO heatmap engine, one row per (fixture, player, period). `derivation` states whether the grid came from real provider coordinates or from an inference over the team sheet and counted actions — no consumer may render a row without it. Invalidated by inputs_fingerprint and engine_version, never by a clock.';

create index if not exists idx_player_heatmaps_fixture on player_heatmaps (fixture_id);
create index if not exists idx_player_heatmaps_player on player_heatmaps (player_id);
create index if not exists idx_player_heatmaps_team on player_heatmaps (team_id);

alter table player_heatmaps enable row level security;

create policy player_heatmaps_select_public on player_heatmaps
  for select to authenticated using (true);
create policy player_heatmaps_insert_admin on player_heatmaps
  for insert to authenticated
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));
create policy player_heatmaps_update_admin on player_heatmaps
  for update to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']))
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));
create policy player_heatmaps_delete_admin on player_heatmaps
  for delete to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']));


-- To reverse:
--   drop table if exists player_heatmaps;
--   drop table if exists fixture_player_statistics;
--   alter table lineups drop column if exists grid;
--   alter table lineups add column pitch_heatmap jsonb;   -- restores 0036's column, still null
