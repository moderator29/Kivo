-- Sportmonks removal (founder directive, 2026-08-15): drops the two Sportmonks-shaped
-- readiness columns added by migration 0036 that nothing reads anymore now that
-- src/lib/football/premium-stats.ts and its gated UI on the player profile page have
-- been removed. See DECISIONS.md for the full removal record.
--
-- lineups.pitch_heatmap (also added by 0036) is deliberately NOT touched here: a
-- sibling work stream is actively rebuilding the heatmap feature as a provider-agnostic
-- HeatmapEngine/PositionalDataProvider this same session, and that column sits squarely
-- in that work's schema surface. Dropping or altering it here risks colliding with
-- concurrent, unreviewed work on the same table. It remains a harmless, always-null,
-- unreferenced column until whoever finishes the heatmap engine decides whether to
-- reuse, rename, or replace it -- that call belongs to that work, not this one.

alter table players drop column market_value_eur;
alter table players drop column market_value_updated_at;
alter table players drop column contract_expires_at;

-- Already applied directly to the live project (gkyjfihxxdynfwqhhpyn) via the Supabase
-- MCP apply_migration tool on 2026-08-15; this file exists so the migration history
-- checked into git matches what's actually running.

-- To reverse (re-adds the columns, still nullable, still unpopulated by any vendor):
--   alter table players add column market_value_eur bigint;
--   alter table players add column market_value_updated_at timestamptz;
--   alter table players add column contract_expires_at date;
