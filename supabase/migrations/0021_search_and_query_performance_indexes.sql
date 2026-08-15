-- Items 31-35 (RECOMMENDATIONS.md): missing indexes for real, already-shipped
-- query patterns.

-- 31. Leading-wildcard ilike searches (command palette, fantasy player picker)
-- cannot use a plain btree index. pg_trgm's GIN index is what actually serves
-- '%term%' matches.
create extension if not exists pg_trgm;

create index idx_teams_name_trgm on teams using gin (name gin_trgm_ops);
create index idx_players_full_name_trgm on players using gin (full_name gin_trgm_ops);
create index idx_players_known_as_trgm on players using gin (known_as gin_trgm_ops);
create index idx_competitions_name_trgm on competitions using gin (name gin_trgm_ops);

-- 32. Migration 0006 indexed only player_id and transfer_date; the player page
-- and a future club transfer ledger join on both team FKs.
create index idx_transfers_from_team_id on transfers (from_team_id);
create index idx_transfers_to_team_id on transfers (to_team_id);

-- 33. The /live page filters on exactly this predicate.
create index idx_fixtures_live_kickoff on fixtures (kickoff_at) where status in ('live', 'halftime');

-- 34. The moderation queue's oldest-first filter on open statuses.
create index idx_reports_status_created_at on reports (status, created_at);

-- 35. Ordered standings-table reads on /leagues/[id] and Match Centre.
create index idx_standings_season_position on standings (season_id, position);

-- To reverse: drop the eleven indexes above (pg_trgm extension left in place
-- even on rollback since dropping it is a separate, riskier decision).
