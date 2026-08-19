-- =============================================================================
-- 0094 — A provider request budget that is enforced, not documented
-- =============================================================================
-- FILE RENUMBERED, DELIBERATELY, AND HERE IS EXACTLY WHAT RAN.
--
-- This was applied to the live project under the migration name
-- `0091_provider_request_ledger`, at version `20260819051151`. That is what the
-- database records and it has NOT been re-run — renaming a file that has
-- already executed is how a migration gets applied twice, so only the file
-- moved.
--
-- It moved because a sibling agent applied `0091_keep_renamed_entity_names` at
-- `20260819051026`, a minute earlier, and two files sharing a `0091` prefix
-- leaves the next reader with no way to tell which ran first from the directory
-- alone. The database was never ambiguous (the names differ); the directory was.
--
-- The real execution order, for anyone reconstructing it: this ran AFTER
-- `0092_rename_alias_triggers` (`20260819051037`) and BEFORE
-- `0093_rename_alias_triggers_must_fire_after` (`20260819051211`). No free
-- number expresses that, so `0094` is "the next one after everything that had
-- landed", and this note carries the precision the number cannot.
-- =============================================================================
-- The live worker (`src/lib/football/scheduled-sync.ts`) has six guards and
-- until now not one of them bounded total spend. The quota floor only refuses
-- once the provider's own remaining count is at or below ten — and that count
-- is NULL until some request has recorded one, so on a fresh day the exact
-- window where a once-a-minute worker is most likely to run away is the window
-- where the guard is asleep. With the flag on and one match live, that is
-- roughly ninety requests in ninety minutes, after which the product has no
-- data at all, including the daily fixture sync. A stale score is bad. No data
-- is worse.
--
-- WHY A CHECK IS NOT A BUDGET
-- ---------------------------
-- "Count what has been spent, then spend" is a check-then-act pair, and under
-- READ COMMITTED two callers each take their own snapshot, both count under the
-- limit, and both spend. There is no row to lock, because what needs locking is
-- an ABSENCE of rows. Migration 0066 already established the fix for exactly
-- this shape in `consume_rate_limit`, and this reuses it: a transaction-scoped
-- advisory lock keyed on (provider, bucket), so same-bucket callers queue
-- behind each other and see each other's inserts, while different buckets never
-- contend. Asking "may I spend" and spending are one statement.
--
-- WHY A ROLLING WINDOW RATHER THAN A CALENDAR DAY
-- -----------------------------------------------
-- Because KIVO cannot establish when API-Football's daily counter resets. This
-- build environment has no route to api-football.com, and the only quota signal
-- the adapter reads is `x-ratelimit-requests-remaining`, which is a count and
-- not a reset time. Assuming UTC midnight and being wrong in the generous
-- direction would mean the budget silently does not exist for part of every
-- day.
--
-- A trailing-window cap of N implies at most N spends in ANY 24-hour interval,
-- including whatever calendar day the provider actually uses. So it is
-- conservative under every possible reset time, and it costs one row per spend
-- rather than a per-day counter — which at the budgets below is under a hundred
-- rows a day, and gives Data Health a "spent in the last 24 hours" figure that
-- is meaningful regardless of when the provider resets.
--
-- WHY SEPARATE BUCKETS RATHER THAN ONE POOL WITH A FLOOR
-- ------------------------------------------------------
-- A reserve expressed as "stop when the shared pool gets low" fails the moment
-- anything else spends unexpectedly. Each automated consumer gets its own
-- independent allowance, so the daily fixture sync's slice is unreachable by
-- the live worker BY CONSTRUCTION rather than by politeness. The live worker
-- exhausting itself cannot starve tomorrow's fixtures.
--
-- Admin-triggered syncs are deliberately NOT a bucket and consume nothing.
-- Leaving headroom outside every automated allowance is the only way to
-- guarantee a human debugging with "Sync now" always has room, and the only way
-- to guarantee it is for automation to be structurally unable to reach it.
--
-- WHY THE LIMITS ARE CONSTANTS IN HERE AND NOT ARGUMENTS
-- ------------------------------------------------------
-- An earlier draft took `p_limit` from the caller. That is check-then-act one
-- level up: the caller decides its own ceiling, so a bug, a stale constant or a
-- future caller passing a larger number silently raises the budget, and a
-- budget a caller can raise is not a budget. The ceilings therefore live here,
-- keyed by bucket, where the only way to change one is a migration.
--
-- The cost is real and accepted: tuning an allowance now needs a migration
-- rather than a constant edit. For a number whose whole job is to be a ceiling
-- on spending somebody else's money, that is the right friction.

create table if not exists provider_request_spend (
  id          bigserial primary key,
  -- Which provider's quota was spent. Two providers have separate quotas, so
  -- they must have separate ledgers.
  provider    text not null,
  -- Which automated consumer spent it: 'live', 'auto', 'daily'. Free text
  -- rather than an enum so adding a consumer is a code change, not a migration
  -- plus an enum value that cannot be used in the same transaction.
  bucket      text not null,
  -- How many provider requests this row accounts for. Almost always 1; a caller
  -- that knows it is about to make several reserves them together so the ledger
  -- cannot under-count a burst.
  requests    integer not null default 1,
  spent_at    timestamptz not null default now(),
  constraint provider_request_spend_requests_positive check (requests >= 1),
  constraint provider_request_spend_bucket_not_blank check (length(btrim(bucket)) > 0),
  constraint provider_request_spend_provider_not_blank check (length(btrim(provider)) > 0)
);

comment on table provider_request_spend is
  'Append-only ledger of provider requests spent by AUTOMATED syncs, one row per spend. Read by consume_provider_requests() over a rolling window — deliberately not a per-day counter, because KIVO cannot establish when the provider''s own daily quota resets and a trailing window is conservative under every possible reset. Admin-triggered syncs are not recorded here and are not budgeted: the headroom left outside every bucket is what guarantees a human always has room.';

-- The only query shape that exists: "how much has bucket B of provider P spent
-- since T". Descending on spent_at so the oldest-in-window lookup the planner
-- uses to compute when the budget frees up is served by the same index.
create index if not exists idx_provider_request_spend_window
  on provider_request_spend (provider, bucket, spent_at desc);

alter table provider_request_spend enable row level security;

-- No policy at all, deliberately. Every write goes through the SECURITY DEFINER
-- function below, and every read is made by the service-role client, which
-- bypasses RLS. RLS enabled with no policy means the anon and authenticated
-- roles can do nothing here, which is correct: this is operational accounting,
-- not content. (`rate_limit_events` has exactly this shape for the same reason.)

-- -----------------------------------------------------------------------------
-- consume_provider_requests — ask and spend, in one statement
-- -----------------------------------------------------------------------------
-- Returns the decision AND the numbers behind it, so a caller can log a real
-- reason rather than "refused". `allowed = false` is an ordinary answer, not an
-- exception: migration 0024 already learned what raising inside a throttle
-- costs — it aborts the transaction and rolls back the very insert that makes
-- the window slide.
--
-- A refused attempt is NOT recorded. A refusal is not a spend, and a ledger
-- that counted refusals would make an exhausted budget stay exhausted longer
-- every time it was asked.
-- ---------------------------------------------------------------------------
-- The allowances. Against API-Football's free tier of ~100 requests/day.
--
--   live   55  the once-a-minute worker, paced across the day's live football
--   auto   20  on-demand freshness on page view (auto-sync.ts)
--   daily   8  the baseline: 1 fixtures call + up to 5 standings + headroom
--              ────
--              83 budgeted, leaving ~17 that NO automated path can reach.
--
-- That remainder is not an oversight and is not a bucket. It is what an admin
-- clicking "Sync now" spends, and the only way to guarantee a human always has
-- room is for automation to be structurally unable to reach it.
--
-- `auto` deserves its own note: auto-sync.ts bounds itself with a three-minute
-- cooldown between attempts and nothing else, which permits up to 480 requests
-- a day — nearly five times the whole tier — and it fires from ordinary page
-- views rather than from a flag anybody has to turn on. This is the bound that
-- did not exist.
-- ---------------------------------------------------------------------------
create or replace function public.provider_request_limit(p_bucket text)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_bucket
    when 'live'  then 55
    when 'auto'  then 20
    when 'daily' then 8
    -- An unrecognised bucket gets nothing. A typo must fail closed: a bucket
    -- name that silently defaulted to a generous number would be a budget with
    -- a spelling-mistake-shaped hole in it.
    else 0
  end;
$$;

comment on function public.provider_request_limit(text) is
  'The authoritative per-bucket ceiling on automated provider requests in a rolling window. Deliberately a constant here rather than an argument to consume_provider_requests: a caller that supplies its own limit decides its own ceiling, which is not a budget. An unknown bucket returns 0 — a typo fails closed.';

create or replace function public.consume_provider_requests(
  p_provider text,
  p_bucket text,
  p_window_seconds integer,
  p_count integer default 1
)
returns table (
  allowed boolean,
  spent_in_window integer,
  request_limit integer,
  oldest_spend_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_since timestamptz;
  v_spent integer;
  v_limit integer;
  v_oldest timestamptz;
begin
  if p_provider is null or btrim(p_provider) = '' or p_bucket is null or btrim(p_bucket) = '' then
    raise exception 'consume_provider_requests requires a non-empty provider and bucket' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'consume_provider_requests requires p_window_seconds >= 1' using errcode = '22023';
  end if;
  if p_count is null or p_count < 1 then
    raise exception 'consume_provider_requests requires p_count >= 1' using errcode = '22023';
  end if;

  v_limit := provider_request_limit(p_bucket);

  -- See the header: the count is an absence of rows, so the serialization has
  -- to be explicit. Keyed per (provider, bucket) so one busy bucket cannot
  -- block another.
  perform pg_advisory_xact_lock(hashtextextended('provider_request:' || p_provider || ':' || p_bucket, 0));

  v_since := now() - make_interval(secs => p_window_seconds);

  select coalesce(sum(requests), 0), min(spent_at)
    into v_spent, v_oldest
  from provider_request_spend
  where provider = p_provider
    and bucket = p_bucket
    and spent_at >= v_since;

  if v_spent + p_count > v_limit then
    return query select false, v_spent, v_limit, v_oldest;
    return;
  end if;

  insert into provider_request_spend (provider, bucket, requests)
  values (p_provider, p_bucket, p_count);

  return query select true, v_spent + p_count, v_limit, coalesce(v_oldest, now());
end;
$$;

comment on function public.consume_provider_requests(text, text, integer, integer) is
  'Atomically reserves provider requests for one automated bucket over a rolling window, or refuses. Asking and spending are one statement — a check-then-spend pair is not a budget. The ceiling comes from provider_request_limit(), never from the caller. Refusals are never recorded.';

-- Service-role only, written exactly the way migration 0066 writes it for
-- `consume_rate_limit` — one `revoke execute ... from public, anon,
-- authenticated` followed by one `grant execute ... to service_role`. This
-- branch has already lost a SECURITY DEFINER function's grants once tonight by
-- recreating it with a different grant shape, so this matches the established
-- pattern character for character rather than improving on it.
--
-- Note that `create or replace function` RESETS privileges to the defaults for
-- the owner, which is why these lines run after every definition above rather
-- than being assumed to survive from a previous migration.
revoke execute on function public.consume_provider_requests(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_provider_requests(text, text, integer, integer) to service_role;
revoke execute on function public.provider_request_limit(text) from public, anon, authenticated;
grant execute on function public.provider_request_limit(text) to service_role;

-- -----------------------------------------------------------------------------
-- prune_provider_request_spend — bounded retention
-- -----------------------------------------------------------------------------
-- The ledger only ever answers questions about a trailing window, so anything
-- older than a few of them is dead weight. Seven days keeps enough history for
-- an admin to see a week of behaviour on Data Health while staying trivially
-- small. Bounded per call for the same reason `prune_rate_limit_events` is: a
-- long backlog should clear over several runs, not in one long delete.
create or replace function public.prune_provider_request_spend(p_max_rows integer default 5000)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  with doomed as (
    select id from provider_request_spend
    where spent_at < now() - interval '7 days'
    limit greatest(1, coalesce(p_max_rows, 5000))
  )
  delete from provider_request_spend p using doomed d where p.id = d.id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.prune_provider_request_spend(integer) from public, anon, authenticated;
grant execute on function public.prune_provider_request_spend(integer) to service_role;


-- -----------------------------------------------------------------------------
-- fixtures.live_reconciled_at — one reconciliation attempt per disappearance
-- -----------------------------------------------------------------------------
-- The live worker polls `/fixtures?live=all`, which returns ONLY in-play
-- matches. A fixture that goes final between two polls therefore stops
-- appearing, and without a fallback its last written state is an in-play
-- scoreline that stays on the product until the next daily sync. That is not a
-- stale score, it is a permanently wrong one.
--
-- So a fixture that has dropped out of the live feed gets one dated fetch to
-- establish its final state. The bound matters as much as the fallback: a
-- provider hiccup, a brief outage or a temporarily misreported match also makes
-- a fixture disappear, and treating every disappearance as "keep asking" means
-- a flapping provider costs a request per minute per fixture.
--
-- This column is what makes it exactly one attempt. The worker reconciles a
-- fixture only when this is null or older than `provider_last_seen_at` — so a
-- second attempt happens only if the fixture came back and disappeared again,
-- which is a genuinely new disappearance rather than the same one being retried.
alter table fixtures add column if not exists live_reconciled_at timestamptz;

comment on column fixtures.live_reconciled_at is
  'When the live worker last spent a dated fetch trying to establish this fixture''s final state after it dropped out of the live feed. Compared against provider_last_seen_at so each disappearance is reconciled exactly once — a flapping provider must not cost a request per minute per fixture.';

create index if not exists idx_fixtures_live_unreconciled
  on fixtures (provider_last_seen_at)
  where status in ('live', 'halftime');

-- To reverse:
--   drop index if exists idx_fixtures_live_unreconciled;
--   alter table fixtures drop column if exists live_reconciled_at;
--   drop function if exists public.prune_provider_request_spend(integer);
--   drop function if exists public.consume_provider_requests(text, text, integer, integer);
--   drop function if exists public.provider_request_limit(text);
--   drop table if exists provider_request_spend;
