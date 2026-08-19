-- =============================================================================
-- 0080 — Five new provider entity types
-- =============================================================================
-- `provider_entity_type` is doing two jobs in this schema: it keys
-- `provider_mappings` (KIVO id <-> provider id, per entity kind) and it types
-- `sync_runs.entity_type`, which is what Admin -> Data Health groups every run
-- by. Adding a data category without adding its entity type would mean either
-- filing its sync runs under a lie ("this coverage refresh was a competition
-- sync") or leaving them out of the health surface entirely.
--
-- The five categories this branch is adding:
--
--   fixture_player_statistic  per-player, per-fixture numbers (/fixtures/players)
--   coverage                  the provider's own capability declaration (/leagues)
--   injury                    /injuries
--   top_scorer                /players/topscorers
--   player_season_statistic   /players?id=&season=
--
-- WHY THIS IS ITS OWN MIGRATION, alone, doing nothing else
-- -------------------------------------------------------
-- Postgres allows `ALTER TYPE ... ADD VALUE` inside a transaction block, but it
-- does NOT allow the new value to be *used* in that same transaction. Supabase's
-- apply_migration runs each migration in one transaction. So a single migration
-- that both adds these values and creates a table with a default or a check
-- referencing one of them fails at apply time — and it fails halfway through a
-- schema change, which is the worst moment for it. Splitting the enum change out
-- is not tidiness; it is the only ordering that works.
--
-- Every value is additive. Nothing is renamed or removed, so no existing row,
-- policy, function signature or client type changes meaning.

alter type provider_entity_type add value if not exists 'fixture_player_statistic';
alter type provider_entity_type add value if not exists 'coverage';
alter type provider_entity_type add value if not exists 'injury';
alter type provider_entity_type add value if not exists 'top_scorer';
alter type provider_entity_type add value if not exists 'player_season_statistic';

-- To reverse: Postgres has no ALTER TYPE ... DROP VALUE. Reversing means
-- recreating the type and every column that uses it, which is a far larger
-- operation than this migration — stated plainly rather than left for whoever
-- tries. In practice these values are inert until something writes them.
