-- =============================================================================
-- 0084 — standings_snapshots is still readable by the anon key
-- =============================================================================
-- Not part of the heatmap/coverage work; found while auditing the RLS pattern
-- to copy for the new tables, and small enough to fix rather than file.
--
-- Migration 0059 removed `anon` from nineteen football SELECT policies, on the
-- reasoning that the `anon` key ships in the browser bundle and the app has no
-- guest preview. Migration 0072 then created `standings_snapshots` with
--
--     for select to authenticated, anon
--
-- and a comment saying "public read, same as `standings` itself" — which was
-- true of `standings` before 0059 and had stopped being true hours earlier.
-- Two agents, one night, one table created against a policy that had just been
-- retired. So today the anon key can read KIVO's full standings history while
-- it cannot read the standings themselves, which is the wrong way round and is
-- nobody's intent.
--
-- Nothing breaks: every consumer of this table (`get_team_position_history`,
-- `get_standings_movement`, and `PositionHistoryCard` through them) runs for a
-- signed-in viewer inside the gated `(app)` route group.
--
-- Deliberately the same shape as the reversal note at the bottom of 0059: if
-- KIVO ever carves out a public read-only preview of match data, this table
-- goes back to `authenticated, anon` alongside the rest of the football
-- reference set, in one deliberate change rather than by having been left open.

drop policy if exists standings_snapshots_select_public on standings_snapshots;

create policy standings_snapshots_select_public on standings_snapshots
  for select to authenticated
  using (true);

-- To reverse (only as part of a deliberate public-preview decision, with the
-- rest of the football reference tables, never on its own):
--   drop policy standings_snapshots_select_public on standings_snapshots;
--   create policy standings_snapshots_select_public on standings_snapshots
--     for select to authenticated, anon using (true);
