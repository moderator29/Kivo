-- Readiness plumbing for three data categories API-Football's free tier does not
-- supply: player market value, contract expiry, and per-player pitch-position heat
-- maps. No vendor is connected yet (no API key exists) -- every column added here
-- stays null on every row until a real paid provider is wired up. Nothing in this
-- migration seeds, estimates, or derives a value for any of these columns.
--
-- Note on migration 0007 / RECOMMENDATIONS.md item 179: those correctly recorded
-- market value as "permanently out of scope" under the $0-budget, no-scraping
-- constraints that held at the time -- that reasoning (no ToS-clean free source
-- exists) still stands and is not being relitigated here. What's changed is that
-- the founder is now willing to pay for a real vendor; this migration only adds
-- the nullable columns a real vendor's data would land in, so the schema is ready
-- the moment a key exists. Until then this is inert.

-- ---------------------------------------------------------------------------
-- players: market value + contract expiry
-- ---------------------------------------------------------------------------
alter table players add column market_value_eur bigint;
alter table players add column market_value_updated_at timestamptz;
alter table players add column contract_expires_at date;

comment on column players.market_value_eur is
  'Player market value in whole euros, from a real paid data vendor (see DECISIONS.md / RECOMMENDATIONS.md item 179 follow-up) -- never estimated, derived, or scraped. Null for every player until that vendor is connected; the UI must not render this field while null.';
comment on column players.market_value_updated_at is
  'When market_value_eur was last refreshed from the vendor. Null whenever market_value_eur is null. Not a general "last synced" timestamp -- scoped to this one field so a stale valuation can be told apart from a fresh one once real data exists.';
comment on column players.contract_expires_at is
  'Real contract-expiry date from a paid data vendor. Null for every player until that vendor is connected -- never guessed from transfer history or squad tenure.';

-- ---------------------------------------------------------------------------
-- lineups: per-player, per-match pitch heat map
-- ---------------------------------------------------------------------------
-- Kept on `lineups` rather than a new table: lineups is already exactly
-- one row per (fixture, team, player) -- the same grain a heatmap needs --
-- mirroring how `formation` (migration 0035) was added directly to this table
-- rather than a new one-row-per-side table.
--
-- Shape is a zone-grid of touch counts rather than a raw x/y point stream: it's
-- the more common delivery shape among mid-tier vendors (e.g. a derived
-- activity-zone grid), is trivial to render as a heat overlay, and stays cheap
-- to store/query as jsonb. A real vendor payload would look like:
--   {
--     "grid": { "cols": 6, "rows": 5 },
--     "zones": [
--       [2, 5, 8, 6, 3, 1],
--       [4, 9, 12, 10, 5, 2],
--       ...  -- 5 rows total, each with 6 touch counts, one row per grid.rows
--     ],
--     "source": "sportmonks",
--     "retrieved_at": "2026-09-01T20:15:00Z"
--   }
-- Zones run left-to-right, own-goal-line-to-opponent-goal-line, in the
-- direction that team attacked in the first half -- orientation is a vendor
-- integration detail to pin down once a real payload is in hand, not guessed
-- at here. Null until a real vendor is connected; never populated with a
-- synthetic/uniform/random grid as a placeholder.
alter table lineups add column pitch_heatmap jsonb;

comment on column lineups.pitch_heatmap is
  'Per-player, per-match pitch activity zone-grid from a real paid data vendor (see column comment history / migration 0036) -- a touch-count grid, not raw event coordinates. Null for every row until that vendor is connected; the UI must not render a heatmap surface while null, and must never synthesize one.';

-- To reverse:
--   alter table lineups drop column pitch_heatmap;
--   alter table players drop column contract_expires_at;
--   alter table players drop column market_value_updated_at;
--   alter table players drop column market_value_eur;
