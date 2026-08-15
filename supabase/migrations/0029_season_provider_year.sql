-- RECOMMENDATIONS.md item 30: seasons.name is documented (see its column
-- comment in 0001_kivo_core_schema.sql) as a "2025/2026" display string, but
-- upsertSeason in src/lib/football/sync.ts actually wrote the bare provider
-- year ("2025"), and syncStandings in src/lib/football/sync-match-details.ts
-- then did Number(season.name) to parse it back out.
--
-- seasons.name is genuinely rendered to users today (teams/[id]'s "League
-- position" card, admin/data-health's gameweek list both interpolate
-- `season.name` straight into on-screen copy), so the display string isn't
-- an invented requirement -- it's a real, already-shipped one that was just
-- never actually formatted. Add a dedicated provider_year column as the
-- bare-year identity syncStandings (and anything else that needs the
-- provider's year rather than a display string) should read, and have
-- upsertSeason format seasons.name as the real "YYYY/YYYY+1" string its own
-- column comment always promised.
--
-- `seasons` has zero rows in every environment as of this migration, so this
-- is a plain additive column with no backfill to reconcile.
alter table seasons add column provider_year integer not null;

comment on column seasons.provider_year is
  'Bare season-start year as reported by the football data provider (e.g. 2025 for the "2025/2026" season). The identity column syncStandings and any other provider-year lookup should read -- seasons.name stays purely the "YYYY/YYYY+1" display string its own comment describes.';
