-- Real per-side formation string (e.g. "4-3-3") from API-Football's
-- /fixtures/lineups response — the raw response already carried this field
-- (see ApiFootballLineupsResponse in src/lib/football/providers/api-football.ts)
-- but it was fetched and then dropped during normalization, never persisted.
-- Denormalized onto every lineup row for that (fixture_id, team_id), same
-- pattern as team_id already being repeated per player row on this table,
-- rather than a separate one-row-per-side table. Null whenever the provider
-- hasn't published a formation yet for that fixture (common before lineups
-- are officially confirmed, ~1 hour pre-kickoff) or for older synced rows
-- from before this column existed.
alter table lineups add column formation text;

-- To reverse: alter table lineups drop column formation;
