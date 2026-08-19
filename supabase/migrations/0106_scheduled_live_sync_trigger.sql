-- =============================================================================
-- 0106 — Scheduled live sync trigger (RENUMBERED, and rescued from disk)
-- =============================================================================
-- FILE RENUMBERED, AND HERE IS EXACTLY WHAT RAN AND WHY THIS EXISTS.
--
-- Applied to the live project under the migration name
-- `0067_scheduled_live_sync_trigger` at version `20260818210505` — confirmed by
-- querying supabase_migrations.schema_migrations directly, not inferred.
--
-- It was never committed. The file sat untracked in a shared working tree while
-- the change itself was live in the database, which is the divergence this
-- branch has spent the night guarding against from the other direction: schema
-- and checked-in history disagreeing, with nothing failing to make anyone look.
-- Had this container been reclaimed, the database would have carried a change
-- no file in the repository could reproduce.
--
-- It also could not keep its original number: `0067_resolve_football_entities`
-- already holds 0067 on the branch. So `0106` means "next after everything that
-- had landed", NOT "last to run" — the applied name and version above are the
-- record of when it actually ran, which was long before most of 0068–0105.
--
-- Nothing is re-applied by renaming a file. The original text follows verbatim.
-- =============================================================================

-- =============================================================================
-- KN-99: the real automated sync trigger
-- =============================================================================
-- `src/app/api/cron/sync-live/route.ts` has existed, adaptive and unit-tested,
-- with nothing calling it. Vercel Cron cannot be that caller: the Hobby plan
-- permits daily crons only, and a more frequent expression fails the deployment
-- outright (https://vercel.com/docs/cron-jobs/usage-and-pricing). A live-scores
-- product cannot be built on one request a day, and the plan change is the
-- founder's call, not something to design around silently.
--
-- The three real alternatives, and why this is the one:
--
--   GitHub Actions `schedule`. Rejected. Its documented minimum is five
--   minutes, delays of 5-30 minutes at peak are ordinary and unavoidable
--   (the queue is on GitHub's side, so a self-hosted runner does not help),
--   and scheduled workflows are auto-disabled after 60 days of repository
--   inactivity. "Sometimes 30 minutes late, and silently off after a quiet
--   two months" is disqualifying for live scores specifically. On a private
--   repository the minute budget also does not survive a 5-minute cadence.
--
--   An external uptime pinger (cron-job.org, UptimeRobot). Workable, and free
--   at one-minute granularity. Rejected as the primary because it puts KIVO's
--   `CRON_SECRET` in a third-party dashboard with no SLA and no audit trail,
--   and adds a vendor whose failure mode is silent. Kept as the documented
--   fallback, because it needs nothing from this repository.
--
--   Supabase pg_cron + pg_net. Chosen. One-minute granularity, available on
--   every Supabase plan including free, running inside the same infrastructure
--   that already holds the data the worker reads and writes — so it is one
--   fewer vendor, not one more. The secret lives in Supabase Vault rather than
--   in a third party's settings page or in this file. And `cron.job_run_details`
--   gives a real execution history, which neither of the alternatives does.
--
-- The worker itself is unchanged. This is purely a caller.
--
-- INERT UNTIL THE FOUNDER TURNS IT ON. The scheduled job runs every minute
-- from the moment this migration applies, and does nothing at all until two
-- Vault secrets exist. That is deliberate: it means switching KIVO from
-- admin-triggered syncing to automated syncing is two dashboard actions and no
-- deployment, and until they are taken this costs a function call that returns
-- immediately. See the bottom of this file for exactly what to add.

create extension if not exists pg_cron;
create extension if not exists pg_net;


-- -----------------------------------------------------------------------------
-- The caller
-- -----------------------------------------------------------------------------
-- Reads both secrets from Vault on every fire rather than baking them in, so
-- rotating `CRON_SECRET` is a Vault edit and nothing else — no migration, no
-- redeploy, and no secret written into a migration file that lives in git
-- forever.
--
-- Returns quietly when either secret is missing. Not an error: "the founder has
-- not switched this on yet" is the expected state, and raising here would fill
-- `cron.job_run_details` with failures describing a decision nobody has made
-- wrongly.
--
-- `net.http_get` is asynchronous by design — it queues the request and returns
-- a request id immediately, so the scheduled job never sits waiting on a
-- serverless cold start and a slow route cannot back up the scheduler. The
-- worker's own `sync_runs` rows are the real record of what happened; this
-- function's job ends at "the request was queued".
create or replace function private.trigger_live_sync()
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_base_url text;
  v_secret text;
begin
  select decrypted_secret into v_base_url from vault.decrypted_secrets where name = 'kivo_app_base_url';
  select decrypted_secret into v_secret   from vault.decrypted_secrets where name = 'kivo_cron_secret';

  if v_base_url is null or v_secret is null or v_base_url = '' or v_secret = '' then
    return;
  end if;

  perform net.http_get(
    url := rtrim(v_base_url, '/') || '/api/cron/sync-live',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      -- So the route's own logs, and any future rate limiting, can tell this
      -- caller apart from a browser or a manual curl.
      'User-Agent', 'kivo-pg-cron/1'
    ),
    timeout_milliseconds := 20000
  );
end;
$$;

-- `private` is not a PostgREST-exposed schema, and 0001's blanket grant on that
-- schema was a one-time grant that does not cover functions created later — but
-- this one reads Vault, so leaving that to convention would be careless.
revoke execute on function private.trigger_live_sync() from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- The schedule
-- -----------------------------------------------------------------------------
-- Every minute, matching what the route was designed for: the schedule is
-- deliberately dumb ("how often to *ask* whether there is work") and every
-- judgement about whether a provider call is actually warranted lives in the
-- route, behind six gates. See its module doc comment.
--
-- Unscheduled first so re-applying this migration replaces the job rather than
-- failing on a duplicate name.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'kivo-live-sync') then
    perform cron.unschedule('kivo-live-sync');
  end if;
  perform cron.schedule('kivo-live-sync', '* * * * *', $job$select private.trigger_live_sync()$job$);

  -- pg_net records every response in `net._http_response` and nothing prunes
  -- it. At one request a minute that is ~43k rows a month of data nobody reads
  -- after the fact — the worker's own `sync_runs` rows are the durable record.
  -- Six hours is long enough to debug a failure that happened overnight.
  if exists (select 1 from cron.job where jobname = 'kivo-prune-net-responses') then
    perform cron.unschedule('kivo-prune-net-responses');
  end if;
  perform cron.schedule(
    'kivo-prune-net-responses',
    '17 * * * *',
    $job$delete from net._http_response where created < now() - interval '6 hours'$job$
  );
end $$;


-- =============================================================================
-- FOUNDER: how to turn this on
-- =============================================================================
-- Two secrets, in the Supabase dashboard under Project Settings -> Vault, or by
-- running these two statements in the SQL editor. Nothing else — no code
-- change, no deployment.
--
--   select vault.create_secret('https://<your-kivo-domain>', 'kivo_app_base_url');
--   select vault.create_secret('<the same value as CRON_SECRET in Vercel>', 'kivo_cron_secret');
--
-- `kivo_cron_secret` must match Vercel's `CRON_SECRET` exactly, or the route
-- will (correctly) answer 401 and nothing will sync.
--
-- Adding these does NOT start spending provider quota. The route still checks
-- `FOOTBALL_LIVE_POLLING_ENABLED` and `API_FOOTBALL_KEY` before it will make a
-- single provider call, and both remain the founder's switches. What these two
-- secrets change is that the worker starts being *asked*, once a minute,
-- instead of never.
--
-- To watch it: `select * from cron.job_run_details order by start_time desc limit 20;`
-- To pause it: `select cron.unschedule('kivo-live-sync');`
--
-- To reverse this migration entirely:
--   select cron.unschedule('kivo-live-sync');
--   select cron.unschedule('kivo-prune-net-responses');
--   drop function if exists private.trigger_live_sync();
--   -- pg_cron/pg_net are left installed; dropping them would affect anything
--   -- else that has come to depend on them since.
