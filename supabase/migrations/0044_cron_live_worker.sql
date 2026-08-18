-- 0044_cron_live_worker.sql
--
-- Founder directive (2026-08-18): build the real, automated Vercel Cron worker
-- (src/app/api/cron/sync-live/route.ts) that decides, once a minute, whether
-- there is anything live/imminent worth spending provider quota on. This
-- migration adds the two pieces of schema that worker needs so its decisions
-- are visible on Admin -> Data Health, distinct from manual "Sync now" runs.

-- 1. sync_status gains 'skipped' — the worker's own no-op decisions (flag
--    off, nothing live, dedup hit, quota floor hit) are genuinely not
--    'running'/'success'/'partial'/'failed'; forcing one of those onto a run
--    that never called the provider would misrepresent what happened. Added
--    in its own statement (not referenced elsewhere in this migration) —
--    Postgres requires a new enum value to be committed before it's used
--    anywhere else, same reason 0017_venue_nullable_name_and_enum_fixes.sql
--    added fixture_status's 'unknown' value on its own.
alter type sync_status add value if not exists 'skipped';

-- 2. sync_runs.trigger_source distinguishes a cron-fired run from an
--    admin-clicked one. Defaults to 'manual' so every existing row (all of
--    them admin-triggered, per docs/LIVE_DATA.md) and every existing caller
--    of syncTodayFixtures()/syncTeamSquad()/etc — none of which pass this —
--    keeps reading exactly as it always has; only the new cron route passes
--    'cron' explicitly.
alter table sync_runs add column trigger_source text not null default 'manual';

alter table sync_runs add constraint sync_runs_trigger_source_check
  check (trigger_source in ('manual', 'cron'));

comment on column sync_runs.trigger_source is
  'Who started this run: ''manual'' (an admin clicked a Data Health/sync button) or ''cron'' (the Vercel Cron worker at /api/cron/sync-live). Lets Data Health show the automated worker''s history distinctly from admin-triggered syncs.';

-- Data Health's planned "automated worker" section queries this shape
-- (trigger_source = 'cron', newest first) directly — index it the same way
-- idx_sync_runs_provider_entity already indexes the provider/entity_type
-- lookup shape.
create index idx_sync_runs_trigger_source on sync_runs (trigger_source, started_at desc);
