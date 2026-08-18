-- =============================================================================
-- Cover three foreign keys on the audit tables added this session
-- =============================================================================
-- Raised by `get_advisors(performance)` after 0056/0076. Included because each
-- of these three is on a real delete path, not because an advisor said so:
--
--   * `data_anomalies.sync_run_id` — `prune_sync_runs()` (migration 0023)
--     deletes `sync_runs` rows older than 90 days, and this FK is ON DELETE SET
--     NULL. Without a covering index Postgres scans the whole of
--     `data_anomalies` once per deleted run, which is exactly the wrong shape
--     for a bulk prune.
--   * `data_anomalies.reviewed_by` and `entity_merges.performed_by` — both
--     reference `profiles`, so both are scanned on account deletion, which is
--     a user-facing action that must not get slower as these tables grow.
--
-- Deliberately NOT indexed: `sync_locks.sync_run_id`, which the same advisor
-- also flags. `sync_locks` holds at most one row per (provider, entity_type) —
-- a handful, forever — so a sequential scan is genuinely faster than an index
-- lookup, and the index would be pure write overhead on the hot path of every
-- sync. An advisor finding that stays open with a stated reason is better than
-- an index nobody wanted.

create index if not exists idx_data_anomalies_sync_run on data_anomalies (sync_run_id);
create index if not exists idx_data_anomalies_reviewed_by on data_anomalies (reviewed_by);
create index if not exists idx_entity_merges_performed_by on entity_merges (performed_by);

-- To reverse:
--   drop index if exists idx_entity_merges_performed_by;
--   drop index if exists idx_data_anomalies_reviewed_by;
--   drop index if exists idx_data_anomalies_sync_run;
