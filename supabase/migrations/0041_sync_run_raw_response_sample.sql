-- RECOMMENDATIONS.md item 65: persist a bounded, admin-diagnosable sample of
-- the last raw provider response a sync run actually received, so a
-- misclassified event type or an unexpected field shape can be diagnosed
-- without spending fresh provider quota to reproduce it.
--
-- Nullable, and deliberately NOT unbounded: `raw_response_sample` stores at
-- most a few KB of JSON (see src/lib/football/raw-response-sample.ts's
-- RAW_RESPONSE_SAMPLE_MAX_CHARS — the app layer truncates before it ever
-- reaches this column), and the check constraint below enforces that same
-- cap on the stored value itself as defense in depth, not just app-layer
-- trust. A day's `/fixtures?date=` response can be hundreds of fixtures;
-- storing that unbounded on every sync_runs row would grow the table forever
-- for no real diagnostic benefit past the first few KB of real field shapes.
--
-- Written by src/lib/football/sync.ts's syncTodayFixtures on both the
-- failure path and the normal finish path (so "on request" — an admin can
-- always see the most recent sample, not only after a failure). Other sync
-- paths (sync-squads.ts, sync-transfers.ts, sync-match-details.ts) can adopt
-- the same column later using the identical
-- provider.getLastRawResponseSample() pattern; not done in this pass to keep
-- the change scoped to the sync flow this item's own text names.
alter table sync_runs add column raw_response_sample jsonb;

alter table sync_runs add constraint sync_runs_raw_response_sample_bounded
  check (
    raw_response_sample is null
    or char_length(raw_response_sample::text) <= 21000 -- ~20,000 chars of body + a small envelope (path/status/capturedAt/truncated keys)
  );

comment on column sync_runs.raw_response_sample is
  'RECOMMENDATIONS.md item 65: bounded sample ({path, status, capturedAt, truncated, bodySample}) of the last raw provider response this run''s provider instance received. Truncated to RAW_RESPONSE_SAMPLE_MAX_CHARS (src/lib/football/raw-response-sample.ts) before it ever reaches this column, never a full unbounded payload.';

-- To reverse: alter table sync_runs drop constraint sync_runs_raw_response_sample_bounded;
-- alter table sync_runs drop column raw_response_sample;
