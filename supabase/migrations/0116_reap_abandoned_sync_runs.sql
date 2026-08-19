-- =============================================================================
-- A dead sync run must never look like a live one
-- =============================================================================
-- `sync_runs` on this database holds seven rows with status='running' and
-- `finished_at` null, started at 14:06, 14:13, 14:18, 14:34, 19:09, 19:12 and
-- 19:14 on 2026-08-19. None of them will ever finish.
--
-- `syncTodayFixtures` has a `finally` whose entire job is to prevent this, and
-- it is correct: success path, catch path and finally path all funnel through
-- one `finalizeRun`. What it cannot cover is the case where the JavaScript
-- never runs at all — a serverless invocation killed at its duration limit, or
-- an aborted request tearing down the isolate. `finally` is a language
-- construct; it needs a live process to execute in. A fixtures sync is hundreds
-- of sequential round trips and no `maxDuration` is configured anywhere in this
-- repository, so the platform default is the ceiling, and hitting it kills the
-- function mid-loop with the row still `running`.
--
-- The lease (`sync_locks`, migration for `claim_sync_lock`) already survives
-- this: it carries an expiry, so a dead holder's claim becomes reclaimable
-- without anybody cleaning it up. The run row carries no such expiry, so it
-- stays `running` forever and Data Health draws a phantom in-progress sync.
--
-- This is the run row's equivalent of the lease's expiry: time-based, so it
-- needs nothing from the dead process.
--
-- -----------------------------------------------------------------------------
-- Why 'failed' and not 'success', 'partial' or a new status
-- -----------------------------------------------------------------------------
-- A reaped run's outcome is genuinely unknown. It may have written three
-- hundred fixtures before it died. `failed` is chosen because it is the only
-- status that cannot be mistaken for a claim about the data:
--
--   * `last_synced_at` stays NULL, so `auto-sync.ts`'s freshness query (which
--     reads only success/partial rows with a non-null `last_synced_at`) never
--     treats an abandoned run as a refresh. A reaped run must not tell the
--     platform its data is fresh.
--   * `records_processed` is left exactly as the dead run left it — usually
--     null. Null here means "nobody recorded a count", which is true. Writing 0
--     would be a fabricated number, and this codebase does not write those.
--
-- The error message says what actually happened rather than inventing a
-- provider failure, because "the provider refused us" and "our own process
-- stopped" are different facts and collapsing them is the recurring bug class
-- on this project.
-- =============================================================================

-- Adding a parameter to a Postgres function does not replace it, it overloads
-- it, and every unqualified call then fails with "function is not unique"
-- (migrations 0072 and 0113). This function is new, but the drop is written
-- anyway so a later signature change has one obvious place to extend.
drop function if exists reap_abandoned_sync_runs(integer);

create or replace function reap_abandoned_sync_runs(p_stale_after_seconds integer default 900)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reaped integer;
begin
  -- Guard the parameter rather than trusting it: a zero or negative threshold
  -- would reap the run that is calling this function.
  if p_stale_after_seconds is null or p_stale_after_seconds < 60 then
    raise exception 'reap_abandoned_sync_runs: p_stale_after_seconds must be at least 60 (got %)', p_stale_after_seconds;
  end if;

  with reaped as (
    update sync_runs
       set status = 'failed',
           finished_at = now(),
           -- Deliberately NOT touching last_synced_at or records_processed.
           -- See this migration's header.
           error_message = coalesce(
             nullif(btrim(error_message), '') || ' | ',
             ''
           ) || 'This run stopped without recording an outcome and was closed after '
              || p_stale_after_seconds
              || ' seconds. It was not refused by the provider — the process running it ended '
              || 'before it could report (most likely a serverless function duration limit). '
              || 'Whatever it had already written is still in the database; how much that was is not recorded.'
     where status = 'running'
       and started_at < now() - make_interval(secs => p_stale_after_seconds)
    returning 1
  )
  select count(*)::integer into v_reaped from reaped;

  return v_reaped;
end;
$$;

comment on function reap_abandoned_sync_runs(integer) is
  'Closes sync_runs rows left in status=running by a process that died before its finally block could run (a serverless duration limit, an aborted request). Time-based by necessity: it needs nothing from the dead process, exactly like the sync_locks lease expiry it mirrors. Never sets last_synced_at and never invents a records_processed, because a reaped run''s outcome is genuinely unknown.';

revoke all on function reap_abandoned_sync_runs(integer) from public;
revoke all on function reap_abandoned_sync_runs(integer) from anon;
revoke all on function reap_abandoned_sync_runs(integer) from authenticated;
grant execute on function reap_abandoned_sync_runs(integer) to service_role;

-- To reverse:
--   drop function if exists reap_abandoned_sync_runs(integer);
