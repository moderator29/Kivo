-- =============================================================================
-- KN-99 (founder follow-up, 2026-08-18): two more ways a sync can start
-- =============================================================================
-- The founder's instruction was plain: "Make it automatic — no need for
-- triggering now." Today the only thing that has ever asked the provider for
-- data is an admin clicking a button, which is why `sync_runs` is empty and
-- every football surface renders its honest empty state.
--
-- `sync_runs.trigger_source` (migration 0044) allows exactly two values,
-- 'manual' and 'cron'. Two more starting points now exist and both need to be
-- distinguishable in Data Health — an admin looking at a run history has to be
-- able to tell "somebody opened /matches and the data was stale" apart from
-- "the once-a-minute worker fired", because they have completely different
-- quota profiles and completely different things go wrong with them.
--
--   'auto'  — a page load found the data stale past that surface's threshold
--             and scheduled a sync *after* the response was sent. Never blocks
--             a render. See src/lib/football/auto-sync.ts.
--   'daily' — the once-a-day Vercel Cron baseline sync. Daily is the only
--             cadence the Hobby plan accepts, and it is enough to keep
--             fixtures, clubs, competitions and standings from being empty.
--
-- Widening a CHECK constraint is additive: every existing row already satisfies
-- the new one, so this cannot fail on data and nothing that reads the column
-- needs to change.

alter table sync_runs drop constraint if exists sync_runs_trigger_source_check;

alter table sync_runs add constraint sync_runs_trigger_source_check
  check (trigger_source in ('manual', 'cron', 'auto', 'daily'));

comment on column sync_runs.trigger_source is
  'Who started this run: ''manual'' (an admin clicked a sync button), ''cron'' (the once-a-minute live worker), ''auto'' (a page load found the data stale and scheduled a sync after the response), or ''daily'' (the once-a-day baseline sync — the only cadence Vercel''s Hobby plan permits). Lets Data Health tell four very different quota profiles apart.';

-- To reverse (only safe once no 'auto'/'daily' rows remain):
--   alter table sync_runs drop constraint sync_runs_trigger_source_check;
--   alter table sync_runs add constraint sync_runs_trigger_source_check
--     check (trigger_source in ('manual', 'cron'));
