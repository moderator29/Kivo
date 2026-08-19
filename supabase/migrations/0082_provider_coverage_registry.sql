-- =============================================================================
-- 0082 — The coverage registry
-- =============================================================================
-- RECOMMENDATIONS item 299 / KIVO_NEXT_GEN KN-53 and KN-103, and a direct
-- founder requirement. `src/lib/football/coverage.ts` shipped the honest interim
-- for this: it counts real rows per competition and consults a hand-transcribed
-- map of what each PROVIDER supports. That map is a constant in TypeScript,
-- copied out of docs/PROVIDER_ABSTRACTION.md, and it is per-provider — so it can
-- say "TheSportsDB has no lineups at all" and cannot say "this provider has no
-- lineups FOR THIS COMPETITION", which is the case that actually bites: a
-- provider that covers lineups for the Premier League and not for the NPFL.
--
-- API-Football answers exactly that question. Its /leagues response carries a
-- `coverage` object per league per season, stating which of its own endpoints
-- will return anything. This table is that declaration, stored.
--
-- WHY A NULLABLE BOOLEAN, EVERYWHERE
-- ----------------------------------
-- Three states, not two:
--
--   true   the provider says it supports this. A tab that is empty is unsynced.
--   false  the provider says it does not. No amount of syncing will ever fill
--          that tab, and telling a user to wait would be a lie.
--   null   the provider said nothing. KIVO does not know.
--
-- Collapsing null into false is the single most tempting mistake here and the
-- one that would do the most damage: it would have KIVO assert, on the
-- provider's behalf, a limitation the provider never claimed — on every
-- competition where a key happened to be missing from a response. `null` renders
-- as "unknown" and nothing else.
--
-- WHY competition_id IS NULLABLE
-- ------------------------------
-- One /leagues request returns coverage for every competition the plan can see,
-- which is far more than KIVO has ever synced. Those rows are worth keeping: the
-- moment a competition IS synced, its coverage is already known and no request
-- is needed to learn it. The provider's own id is always stored, so
-- `reconcileCoverageCompetitions` can fill the FK in later without spending
-- quota — the same pattern transfers already uses for unresolved clubs
-- (migration 0030 / RECOMMENDATIONS item 64).

create table if not exists provider_coverage (
  id                          uuid primary key default gen_random_uuid(),
  -- Which provider said this. Coverage is a statement BY a provider, so two
  -- providers can hold different, equally true positions on the same
  -- competition, and neither overwrites the other.
  provider                    text not null,
  provider_competition_id     text not null,
  season_year                 smallint not null,
  -- Filled in when this competition is (or becomes) known to KIVO. Null for
  -- every competition KIVO has never synced.
  competition_id              uuid references competitions (id) on delete set null,
  -- The provider's own name for it, kept even when unresolved, so an admin
  -- looking at the registry sees "Serie A" rather than a bare id.
  competition_name            text,

  fixture_events              boolean,
  fixture_lineups             boolean,
  fixture_statistics          boolean,
  -- The flag the heatmap depends on: whether per-PLAYER match statistics exist
  -- for this competition at all.
  fixture_player_statistics   boolean,
  standings                   boolean,
  players                     boolean,
  top_scorers                 boolean,
  top_assists                 boolean,
  top_cards                   boolean,
  injuries                    boolean,
  predictions                 boolean,
  odds                        boolean,

  -- The provider's coverage object verbatim. A capability KIVO has not modelled
  -- yet survives here instead of being discarded, and a future reader can check
  -- the mapping above against its source without re-spending a request.
  raw                         jsonb,
  retrieved_at                timestamptz not null default now(),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint provider_coverage_unique_scope unique (provider, provider_competition_id, season_year),
  constraint provider_coverage_season_sane check (season_year >= 1900 and season_year <= 2200)
);

comment on table provider_coverage is
  'What a data provider declares it supports, per competition per season, read from its own leagues endpoint. Every capability column is a NULLABLE boolean: true = supported, false = the provider says never, null = the provider said nothing and KIVO does not know. Null must never be rendered as false.';

comment on column provider_coverage.competition_id is
  'Null until this competition is synced into KIVO. The provider id is always kept, so the link can be made later with no provider request — same reconciliation pattern as transfers.from_team_provider_id.';

create trigger trg_provider_coverage_updated_at before update on provider_coverage
  for each row execute function set_updated_at();

create index if not exists idx_provider_coverage_competition on provider_coverage (competition_id);
create index if not exists idx_provider_coverage_provider_season on provider_coverage (provider, season_year);
-- Partial index over exactly the rows the reconciliation pass scans.
create index if not exists idx_provider_coverage_unresolved
  on provider_coverage (provider, provider_competition_id)
  where competition_id is null;

alter table provider_coverage enable row level security;

-- Readable by any signed-in user: this is what powers "this competition does not
-- publish lineups" on a public-facing competition page, so it has to reach the
-- browser. It contains no user data and no provider credentials.
create policy provider_coverage_select_public on provider_coverage
  for select to authenticated using (true);
create policy provider_coverage_insert_admin on provider_coverage
  for insert to authenticated
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));
create policy provider_coverage_update_admin on provider_coverage
  for update to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']))
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));
create policy provider_coverage_delete_admin on provider_coverage
  for delete to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']));

-- To reverse:
--   drop table if exists provider_coverage;
