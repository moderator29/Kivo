-- =============================================================================
-- 0118 — A cache that survives the function, a health record that is measured,
--        and a budget that knows which provider it is spending
-- =============================================================================
-- Three things land together because they are one mechanism seen from three
-- angles: the thing that stops KIVO asking twice, the thing that records what
-- happened when it did ask, and the thing that decides whether it may ask at
-- all. Splitting them across migrations would leave two of the three unable to
-- describe the third.
--
-- -----------------------------------------------------------------------------
-- WHY A CACHE IN THE DATABASE AT ALL — there is already `next: { revalidate }`
-- -----------------------------------------------------------------------------
-- `docs/CACHING_STRATEGY.md` is honest that the only caching in the football
-- path today is a `revalidate` window per provider endpoint, set as a constant
-- next to each fetch. That layer is real and it stays. What it cannot do is the
-- two things this table exists for:
--
--   1. DEDUPLICATE ACROSS INVOCATIONS. Next's fetch cache is per deployment
--      instance. Two serverless invocations that start in the same second on
--      two different instances both miss, and both spend a request. On a free
--      tier of ~100/day that is not a rounding error, it is the difference
--      between a working product and an empty one.
--   2. SERVE STALE ON PURPOSE. `revalidate` has exactly one deadline: before
--      it, the cached body; after it, a fetch. There is no state in between,
--      so a provider outage turns straight into an empty screen even though a
--      four-minute-old answer was sitting right there.
--
-- This table has two deadlines rather than one — `fresh_until` and
-- `stale_until` — and a lease. Before `fresh_until` nobody asks. Between the
-- two, exactly one caller is granted the lease and asks while everybody else is
-- handed the stale body immediately. After `stale_until` the body is no longer
-- good enough to serve, but it is still better than nothing when the provider
-- is refusing, so it is kept until the pruner takes it and the application
-- decides whether to use it.
--
-- -----------------------------------------------------------------------------
-- WHY THE LEASE IS THE DEDUPLICATION, and why it is here and not in the process
-- -----------------------------------------------------------------------------
-- The usual in-process answer to "two callers want the same thing" is a map of
-- in-flight promises. That works inside one process and is a lie at scale: a
-- serverless function shares no memory between invocations, so the map is empty
-- on every cold start and every parallel instance. The only place two
-- concurrent invocations can agree on who is fetching is the database they both
-- already talk to. `refresh_lease_owner` + `refresh_lease_until` is that
-- agreement, taken under the same advisory lock that reads the entry, so asking
-- "is it fresh, and if not may I be the one to fetch it" is ONE statement —
-- the same shape migration 0094 established for the request budget, for the
-- same read-committed reason.
--
-- The lease EXPIRES rather than being released. A holder that dies mid-fetch
-- (the serverless duration limit that migration 0116 exists for) must not wedge
-- a resource class forever, and it cannot run cleanup code precisely because it
-- died. Time is the only thing that needs nothing from the dead process.
--
-- -----------------------------------------------------------------------------
-- WHY THE TTLs ARE NOT IN THIS FILE
-- -----------------------------------------------------------------------------
-- Deliberately unlike the request budget, whose ceilings live in SQL because a
-- caller that picks its own ceiling has no ceiling. A TTL is not a ceiling on
-- somebody else's money — it is a statement about how fast a kind of football
-- fact changes, it is read by application code that must also branch on it, and
-- it needs to be unit-testable without a database. So the policy table lives in
-- `src/lib/football/cache/resource-classes.ts` and the seconds arrive here as
-- arguments. The database enforces the WINDOW; the application declares the
-- LENGTH.
--
-- The one thing this file does enforce is that a caller cannot write an entry
-- that is stale before it is fresh (`stale_until >= fresh_until`), because that
-- combination has no meaning and would make the state machine unanswerable.
-- =============================================================================

create table if not exists provider_response_cache (
  -- The natural key is exactly the question being asked: which provider, which
  -- kind of football fact, which instance of it. No surrogate id, because there
  -- is never a reason to address a cache entry by anything else.
  provider            text not null,
  resource_class      text not null,
  cache_key           text not null,

  -- All four of these are null together on a lease-only row: a caller that
  -- missed, won the right to fetch, and has not come back yet. That row is not
  -- a cache entry, it is a claim — and it has to exist as a row because the
  -- claim is the thing other callers need to see.
  payload             jsonb,
  fetched_at          timestamptz,
  fresh_until         timestamptz,
  stale_until         timestamptz,

  -- Who is currently fetching, and until when. Opaque to the database; the
  -- application generates it per attempt (see provider-cache.ts) so a release
  -- can only be performed by the attempt that took the lease.
  refresh_lease_owner text,
  refresh_lease_until timestamptz,

  -- How many times this entry has been served without a provider request. The
  -- only number on this table that is about KIVO rather than about football,
  -- and the only honest way to answer "did the cache actually save anything".
  served_count        bigint not null default 0,

  updated_at          timestamptz not null default now(),

  primary key (provider, resource_class, cache_key),

  constraint provider_response_cache_body_all_or_nothing check (
    (payload is null and fetched_at is null and fresh_until is null and stale_until is null)
    or
    (payload is not null and fetched_at is not null and fresh_until is not null and stale_until is not null)
  ),
  -- Stale-before-fresh has no meaning. Rejected at the boundary rather than
  -- being coerced, because a caller that computed those two numbers the wrong
  -- way round has a bug worth seeing.
  constraint provider_response_cache_stale_after_fresh check (
    stale_until is null or fresh_until is null or stale_until >= fresh_until
  ),
  constraint provider_response_cache_provider_not_blank check (length(btrim(provider)) > 0),
  constraint provider_response_cache_class_not_blank check (length(btrim(resource_class)) > 0),
  constraint provider_response_cache_key_not_blank check (length(btrim(cache_key)) > 0)
);

comment on table provider_response_cache is
  'Cross-invocation cache of provider responses, with two deadlines (fresh_until, stale_until) and a refresh lease. The lease is the request deduplication: a serverless function shares no memory between invocations, so the only place two concurrent callers can agree on who is fetching is the database. TTLs are NOT set here — they are declared per resource class in src/lib/football/cache/resource-classes.ts and arrive as arguments, because a TTL is a claim about how fast football changes and has to be unit-testable without a database.';

comment on column provider_response_cache.refresh_lease_until is
  'Leases expire rather than being released, so a holder killed by a serverless duration limit cannot wedge a resource class forever — it cannot run cleanup code precisely because it died. Same reasoning as sync_locks and reap_abandoned_sync_runs.';

-- Two access patterns, both by the primary key or by a sweep over expiry. The
-- pruner reads stale_until across every provider, so it gets its own index
-- rather than a sequential scan of an ever-growing table.
create index if not exists idx_provider_response_cache_expiry
  on provider_response_cache (stale_until);

-- "What is cached, per class, and how fresh is it" — the Admin provider page's
-- only query shape against this table.
create index if not exists idx_provider_response_cache_class
  on provider_response_cache (provider, resource_class, fetched_at desc);

alter table provider_response_cache enable row level security;

-- No policy, deliberately — same posture as provider_request_spend and
-- rate_limit_events. Every read and write is service-role or SECURITY DEFINER.
-- This is operational machinery, not content, and a cached provider payload is
-- the last thing that should be reachable with the publishable key.


-- =============================================================================
-- provider_request_log — the measurements the Admin provider page is made of
-- =============================================================================
-- Every number on that page has to come from somewhere real. Before this table
-- the only durable record of a provider interaction was `sync_runs`, which
-- records a JOB rather than a REQUEST: one row covering hundreds of round
-- trips, with no latency, no per-request status, and nothing at all for a
-- request made outside a sync run.
--
-- So "average response latency" had no source. The rule this project keeps
-- breaking and re-learning is that an unknown number must render as unknown,
-- never as zero — a 0ms latency and a green tick over an empty database are the
-- same bug wearing different clothes. `latency_ms` is therefore NULLABLE and
-- stays null when nothing measured it. There is no default.
--
-- One row per provider REQUEST, not per sync, and not per cache read: a request
-- that was served from cache never happened as far as the provider is
-- concerned, and logging it here would make the failure rate lie in the
-- flattering direction. `cache_state` records why a request happened at all.
-- =============================================================================

create table if not exists provider_request_log (
  id             bigserial primary key,
  provider       text not null,
  -- Which policy class the request was made under. Nullable because a transport
  -- probe (an account-status call, a health check) belongs to no class.
  resource_class text,
  outcome        text not null,
  -- The normalized KIVO error kind — 'rate_limited', 'auth', 'plan',
  -- 'not_found', 'timeout', 'malformed_response', 'empty_response',
  -- 'partial_data', 'server_error', 'client_error', 'network_error'. Text
  -- rather than an enum so the taxonomy can grow in application code without a
  -- migration plus an enum value that cannot be used in the same transaction —
  -- the same reasoning provider_request_spend.bucket carries.
  error_kind     text,
  http_status    integer,
  -- NULL means nobody measured it. It never means zero. See the header.
  latency_ms     integer,
  quota_remaining integer,
  cache_state    text,
  attempts       integer,
  -- Operator-facing, already redacted by the application. Nothing that reaches
  -- this column may contain a credential; `redactProviderSecrets` in
  -- src/lib/football/providers/provider-request.ts is what guarantees it, and
  -- it runs before the insert rather than on the way out, so a key cannot be
  -- at rest here even briefly.
  message        text,
  occurred_at    timestamptz not null default now(),

  constraint provider_request_log_outcome check (outcome in ('success', 'error')),
  constraint provider_request_log_latency_sane check (latency_ms is null or latency_ms >= 0),
  constraint provider_request_log_attempts_sane check (attempts is null or attempts >= 1),
  constraint provider_request_log_provider_not_blank check (length(btrim(provider)) > 0),
  -- An error row without a kind is a row nobody can act on.
  constraint provider_request_log_error_has_kind check (outcome <> 'error' or error_kind is not null)
);

comment on table provider_request_log is
  'One row per provider REQUEST (never per cache hit, never per sync job), carrying the measured latency, the normalized KIVO error kind, and the quota reading if the response carried one. latency_ms is nullable and has no default because an unmeasured latency must render as unknown, not as zero. Messages are redacted by the application before insert, so no credential is ever at rest here.';

create index if not exists idx_provider_request_log_recent
  on provider_request_log (provider, occurred_at desc);

-- "When did this provider last fail, and with what" — served without touching
-- the successful rows, which outnumber the failures by design.
create index if not exists idx_provider_request_log_failures
  on provider_request_log (provider, occurred_at desc)
  where outcome = 'error';

alter table provider_request_log enable row level security;
-- No policy: service-role reads only, same as above.


-- =============================================================================
-- claim_provider_cache_entry — read the entry and decide who fetches, at once
-- =============================================================================
-- Returns the entry's state AND whether this caller may make the provider
-- request, because those two answers have to be consistent with each other and
-- a caller that asks them separately has re-introduced check-then-act.
--
-- `state` is what the entry is, not what the caller should do:
--   'fresh'   inside fresh_until. Nobody fetches.
--   'stale'   past fresh_until, inside stale_until. Body is still servable;
--             exactly one caller is granted the lease to refresh it.
--   'expired' past stale_until. Body is kept (a provider outage makes an old
--             answer valuable again) but the application decides whether it is
--             good enough to serve.
--   'miss'    no body at all — either no row, or a lease-only row from an
--             attempt that has not returned.
--
-- `may_fetch` is granted to at most one caller at a time per key, and is
-- granted even when the state is 'fresh' if the caller passed p_force — the
-- one path an operator's explicit "refresh now" needs. A fresh entry with
-- p_force still returns its body, so a forced refresh that then fails can fall
-- back to what was already there.
-- =============================================================================

drop function if exists claim_provider_cache_entry(text, text, text, integer, text, boolean);

create or replace function public.claim_provider_cache_entry(
  p_provider text,
  p_resource_class text,
  p_cache_key text,
  p_lease_seconds integer default 30,
  p_owner text default null,
  p_force boolean default false
)
returns table (
  state           text,
  payload         jsonb,
  fetched_at      timestamptz,
  fresh_until     timestamptz,
  stale_until     timestamptz,
  may_fetch       boolean,
  lease_until     timestamptz,
  lease_held_by_other boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row provider_response_cache%rowtype;
  v_state text;
  v_may boolean := false;
  v_lease_until timestamptz;
  v_held_by_other boolean := false;
begin
  if p_provider is null or btrim(p_provider) = ''
     or p_resource_class is null or btrim(p_resource_class) = ''
     or p_cache_key is null or btrim(p_cache_key) = '' then
    raise exception 'claim_provider_cache_entry requires a non-empty provider, resource_class and cache_key'
      using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 1 then
    raise exception 'claim_provider_cache_entry requires p_lease_seconds >= 1' using errcode = '22023';
  end if;

  -- Reading the entry and taking the lease must be one statement, for exactly
  -- the reason migration 0094 spells out: what needs serializing is partly an
  -- ABSENCE of rows, so there is nothing to lock with `for update`. Keyed on
  -- the full cache key so two different resources never contend.
  perform pg_advisory_xact_lock(
    hashtextextended('provider_cache:' || p_provider || ':' || p_resource_class || ':' || p_cache_key, 0)
  );

  select * into v_row
  from provider_response_cache
  where provider = p_provider and resource_class = p_resource_class and cache_key = p_cache_key;

  if not found or v_row.payload is null then
    v_state := 'miss';
  elsif now() < v_row.fresh_until then
    v_state := 'fresh';
  elsif now() < v_row.stale_until then
    v_state := 'stale';
  else
    v_state := 'expired';
  end if;

  v_held_by_other := found
    and v_row.refresh_lease_until is not null
    and v_row.refresh_lease_until > now()
    and coalesce(v_row.refresh_lease_owner, '') is distinct from coalesce(p_owner, '');

  -- The whole point: a fresh entry costs nobody a request, and a non-fresh one
  -- costs exactly one caller a request no matter how many arrive at once.
  if (v_state <> 'fresh' or p_force) and not v_held_by_other then
    v_may := true;
    v_lease_until := now() + make_interval(secs => p_lease_seconds);
  end if;

  if v_may then
    insert into provider_response_cache as c
      (provider, resource_class, cache_key, refresh_lease_owner, refresh_lease_until, updated_at)
    values
      (p_provider, p_resource_class, p_cache_key, p_owner, v_lease_until, now())
    on conflict (provider, resource_class, cache_key) do update
      set refresh_lease_owner = excluded.refresh_lease_owner,
          refresh_lease_until = excluded.refresh_lease_until,
          updated_at = now();
  elsif v_state in ('fresh', 'stale') then
    -- Only a served body counts as served. A caller that was handed nothing,
    -- or an expired body it may refuse to use, has not been saved a request.
    update provider_response_cache
       set served_count = served_count + 1
     where provider = p_provider and resource_class = p_resource_class and cache_key = p_cache_key;
  end if;

  return query select
    v_state,
    v_row.payload,
    v_row.fetched_at,
    v_row.fresh_until,
    v_row.stale_until,
    v_may,
    v_lease_until,
    v_held_by_other;
end;
$$;

comment on function public.claim_provider_cache_entry(text, text, text, integer, text, boolean) is
  'Reads a cache entry and decides, in the same statement, whether this caller is the one that may make the provider request. Asking those separately is check-then-act and lets two concurrent invocations both spend a request for the same resource. At most one lease per key is live at a time; leases expire rather than being released.';

-- -----------------------------------------------------------------------------
-- write_provider_cache — store the body and let go of the lease
-- -----------------------------------------------------------------------------
-- The lease is only cleared if this caller still holds it. A slow attempt whose
-- lease already expired, and whose key has since been re-leased by somebody
-- else, must not clear the new holder's claim — it lost the race, and its body
-- is still worth storing, but it does not get to speak for the current fetch.
-- -----------------------------------------------------------------------------
create or replace function public.write_provider_cache(
  p_provider text,
  p_resource_class text,
  p_cache_key text,
  p_payload jsonb,
  p_fresh_seconds integer,
  p_stale_seconds integer,
  p_owner text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_fresh timestamptz;
  v_stale timestamptz;
begin
  if p_payload is null then
    raise exception 'write_provider_cache will not store a null payload — a miss is the absence of a body, not a stored one'
      using errcode = '22023';
  end if;
  if p_fresh_seconds is null or p_fresh_seconds < 0 or p_stale_seconds is null or p_stale_seconds < 0 then
    raise exception 'write_provider_cache requires non-negative p_fresh_seconds and p_stale_seconds' using errcode = '22023';
  end if;

  v_fresh := v_now + make_interval(secs => p_fresh_seconds);
  -- Stale window is measured from the fetch, and is at least as long as the
  -- fresh window: the table's own check constraint refuses the alternative, so
  -- clamping here turns a caller's ordering mistake into the conservative
  -- answer (no stale window at all) rather than a failed write that loses a
  -- body somebody already paid a provider request for.
  v_stale := greatest(v_now + make_interval(secs => p_stale_seconds), v_fresh);

  insert into provider_response_cache as c
    (provider, resource_class, cache_key, payload, fetched_at, fresh_until, stale_until,
     refresh_lease_owner, refresh_lease_until, updated_at)
  values
    (p_provider, p_resource_class, p_cache_key, p_payload, v_now, v_fresh, v_stale, null, null, v_now)
  on conflict (provider, resource_class, cache_key) do update
    set payload = excluded.payload,
        fetched_at = excluded.fetched_at,
        fresh_until = excluded.fresh_until,
        stale_until = excluded.stale_until,
        refresh_lease_owner = case
          when c.refresh_lease_owner is not distinct from p_owner then null
          else c.refresh_lease_owner end,
        refresh_lease_until = case
          when c.refresh_lease_owner is not distinct from p_owner then null
          else c.refresh_lease_until end,
        updated_at = excluded.updated_at;

  return v_fresh;
end;
$$;

comment on function public.write_provider_cache(text, text, text, jsonb, integer, integer, text) is
  'Stores a provider response and releases the refresh lease, but only if this caller still holds it — a slow attempt whose lease expired must not clear the current holder''s claim. TTLs arrive as arguments because they are declared in application code (resource-classes.ts), not here.';

-- -----------------------------------------------------------------------------
-- release_provider_cache_lease — the fetch failed, let the next caller try
-- -----------------------------------------------------------------------------
-- Without this, a failed fetch would hold the key for the full lease duration
-- and every other caller would be handed stale data (or nothing) until it
-- expired. Failing is not a reason to keep the claim; it is the reason to give
-- it up. Only the holder may release, for the same reason as above.
-- -----------------------------------------------------------------------------
create or replace function public.release_provider_cache_lease(
  p_provider text,
  p_resource_class text,
  p_cache_key text,
  p_owner text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_released integer;
begin
  update provider_response_cache
     set refresh_lease_owner = null,
         refresh_lease_until = null,
         updated_at = now()
   where provider = p_provider
     and resource_class = p_resource_class
     and cache_key = p_cache_key
     and refresh_lease_owner is not distinct from p_owner;
  get diagnostics v_released = row_count;

  -- A lease-only row (no body) that has just been abandoned is dead weight and
  -- would otherwise sit there until the pruner's expiry sweep, which never
  -- matches it because it has no stale_until. Removed here, where it is known
  -- to be empty.
  delete from provider_response_cache
   where provider = p_provider
     and resource_class = p_resource_class
     and cache_key = p_cache_key
     and payload is null
     and refresh_lease_owner is null;

  return v_released > 0;
end;
$$;

comment on function public.release_provider_cache_lease(text, text, text, text) is
  'Gives up a refresh lease after a failed fetch so the next caller may try, instead of making every other caller wait out the lease. Deletes the row entirely if it was lease-only, since an empty row has no expiry for the pruner to match.';

-- -----------------------------------------------------------------------------
-- invalidate_provider_cache — an event, not a clock, says this is out of date
-- -----------------------------------------------------------------------------
-- Standings are the case this exists for. A league table's TTL is a guess about
-- when it might have changed; a finished match is a FACT that it did. Rather
-- than shortening the TTL for everybody (which spends quota all week to catch
-- the few hours a week that matter), the entries are expired at the moment the
-- thing that changes them happens.
--
-- Expiring rather than deleting, on purpose: the old table is still the best
-- answer available until the new one arrives, and deleting it would turn a
-- goal in the 89th minute into an empty screen. `fresh_until` is pulled back to
-- now and the stale window is left alone.
-- -----------------------------------------------------------------------------
create or replace function public.invalidate_provider_cache(
  p_provider text,
  p_resource_class text,
  p_key_prefix text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update provider_response_cache
     set fresh_until = least(fresh_until, now()),
         updated_at = now()
   where provider = p_provider
     and resource_class = p_resource_class
     and payload is not null
     and fresh_until > now()
     and (p_key_prefix is null or cache_key like p_key_prefix || '%');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.invalidate_provider_cache(text, text, text) is
  'Expires cached entries because an event says they are out of date (a finished match invalidating a league table), rather than because a clock ran out. Pulls fresh_until back to now and leaves the stale window intact — the old table is still the best answer until the new one arrives.';

-- -----------------------------------------------------------------------------
-- prune_provider_response_cache / prune_provider_request_log — bounded retention
-- -----------------------------------------------------------------------------
-- Both bounded per call, exactly like prune_provider_request_spend: a backlog
-- should clear over several janitor runs rather than in one long delete.
--
-- The cache keeps bodies for a day past their stale window. That grace is not
-- laziness — it is the window in which an outage can still be survived by
-- serving something old, which is the difference between a degraded product and
-- an empty one.
-- -----------------------------------------------------------------------------
create or replace function public.prune_provider_response_cache(p_max_rows integer default 2000)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  with doomed as (
    select provider, resource_class, cache_key
    from provider_response_cache
    where stale_until is not null
      and stale_until < now() - interval '1 day'
      and (refresh_lease_until is null or refresh_lease_until < now())
    limit greatest(1, coalesce(p_max_rows, 2000))
  )
  delete from provider_response_cache c
   using doomed d
   where c.provider = d.provider and c.resource_class = d.resource_class and c.cache_key = d.cache_key;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.prune_provider_request_log(p_max_rows integer default 5000)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  with doomed as (
    select id from provider_request_log
    where occurred_at < now() - interval '14 days'
    limit greatest(1, coalesce(p_max_rows, 5000))
  )
  delete from provider_request_log l using doomed d where l.id = d.id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- `create or replace function` resets privileges to the owner's defaults, which
-- is why every grant below runs after every definition above rather than being
-- assumed to survive. Written in migration 0066's exact shape — one revoke from
-- public, anon, authenticated, then one grant to service_role — because this
-- branch has already lost a SECURITY DEFINER function's grants once by
-- improving on that shape.
revoke execute on function public.claim_provider_cache_entry(text, text, text, integer, text, boolean) from public, anon, authenticated;
grant execute on function public.claim_provider_cache_entry(text, text, text, integer, text, boolean) to service_role;
revoke execute on function public.write_provider_cache(text, text, text, jsonb, integer, integer, text) from public, anon, authenticated;
grant execute on function public.write_provider_cache(text, text, text, jsonb, integer, integer, text) to service_role;
revoke execute on function public.release_provider_cache_lease(text, text, text, text) from public, anon, authenticated;
grant execute on function public.release_provider_cache_lease(text, text, text, text) to service_role;
revoke execute on function public.invalidate_provider_cache(text, text, text) from public, anon, authenticated;
grant execute on function public.invalidate_provider_cache(text, text, text) to service_role;
revoke execute on function public.prune_provider_response_cache(integer) from public, anon, authenticated;
grant execute on function public.prune_provider_response_cache(integer) to service_role;
revoke execute on function public.prune_provider_request_log(integer) from public, anon, authenticated;
grant execute on function public.prune_provider_request_log(integer) to service_role;


-- =============================================================================
-- A budget that knows which provider it is spending
-- =============================================================================
-- Migration 0094 keyed the ceilings on the BUCKET alone, which was right when
-- there was one provider. It stops being right the moment there are three,
-- because the buckets describe KIVO's consumers and the ceilings describe
-- somebody else's tier — and those two tiers are not the same size.
--
-- `consume_provider_requests` already took a provider argument and already kept
-- separate ledgers per provider. Only the CEILING was provider-blind. So this
-- is genuinely an extension of what is there, not a replacement: the ledger
-- table, the advisory-lock shape, the "refusals are never recorded" rule and
-- the "the caller may not supply its own limit" rule all stand exactly as they
-- were.
--
-- -----------------------------------------------------------------------------
-- ADDING A PARAMETER OVERLOADS, IT DOES NOT REPLACE
-- -----------------------------------------------------------------------------
-- Migrations 0072, 0113 and 0116 all record the same lesson: `create or replace`
-- with an extra parameter leaves the old signature in place, and every
-- unqualified call then fails with "function is not unique". Both old
-- signatures are therefore dropped explicitly below before the new ones are
-- created. `provider_request_limit(text)` has exactly one caller in the whole
-- system — `consume_provider_requests`, recreated here — and none in TypeScript.
--
-- -----------------------------------------------------------------------------
-- WHAT THE NUMBERS ARE, AND WHAT THEY ARE NOT
-- -----------------------------------------------------------------------------
-- API-Football's row is unchanged from 0094/0107 and is grounded in a published
-- tier (100/day, 10/min — docs/API_FOOTBALL.md). TheSportsDB's minute pace is
-- likewise the documented ~30/min its adapter was already written against.
--
-- **The two new providers' real limits are not known from this environment.**
-- Both api.bigballsdata.com and api.football-data.org are blocked by the egress
-- proxy this was built behind, so their pricing pages and their rate-limit
-- headers are equally unreachable. Inventing a number for them would be exactly
-- the class of fabrication this project keeps having to undo.
--
-- So the numbers below for `bigballs` and `football-data` are NOT claims about
-- those providers. They are KIVO'S OWN SELF-IMPOSED PACE, set to the tightest
-- budget this codebase already has evidence for, on the reasoning that being
-- too careful with an unknown tier costs some freshness while being too
-- generous costs the whole day's data. When somebody with network access reads
-- the real published limits, this file is the one place to change — and the
-- Admin provider page reads the ceiling back out of the database, so a stale
-- number here shows up as an honest figure there rather than as a silent
-- divergence.
--
-- -----------------------------------------------------------------------------
-- WHY AN UNKNOWN PROVIDER GETS ZERO, AND WHY THE ALIASES EXIST
-- -----------------------------------------------------------------------------
-- Fail-closed, matching the unknown-bucket rule 0094 set: a provider id nobody
-- has budgeted must not spend, because the alternative is a typo silently
-- getting a generous allowance. The cost of that strictness is real — an
-- adapter that names itself `bbs` instead of `bigballs` would be refused every
-- request — so the normalizer below accepts the plausible spellings of each
-- provider rather than one exact string, and `consume_provider_requests` returns
-- `refusal_reason = 'unknown_provider'` so the Admin page names the actual
-- problem instead of drawing an exhausted budget.
--
-- -----------------------------------------------------------------------------
-- WHY A BURST LIMIT AT ALL
-- -----------------------------------------------------------------------------
-- The rolling-24h ledger cannot see a burst: twelve requests spread across a
-- day and twelve fired in ninety seconds are identical to it, and only one of
-- them gets a 429. `sync-catalogue.ts` already worked around this by reading
-- the last spend timestamp and refusing if it was too recent — a real guard,
-- but one that lives in one caller and bounds one bucket. This moves it into
-- the same statement that does the reservation, where every caller gets it.
--
-- The burst window is counted across ALL buckets of a provider, because the
-- provider's per-minute limit is not divided into KIVO's consumers. That means
-- the burst check needs a provider-wide lock, not the per-bucket one — so both
-- locks are taken, provider first then bucket, always in that order, so two
-- callers can never take them in opposite orders and deadlock.
-- =============================================================================

-- The canonical provider id, from whatever an adapter happens to call itself.
-- Deliberately generous: the cost of an unrecognised spelling is a provider
-- that cannot spend at all.
create or replace function public.normalize_provider_id(p_provider text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case lower(btrim(coalesce(p_provider, '')))
    when 'api-football'      then 'api-football'
    when 'apifootball'       then 'api-football'
    when 'api_football'      then 'api-football'
    when 'thesportsdb'       then 'thesportsdb'
    when 'the-sports-db'     then 'thesportsdb'
    when 'bigballs'          then 'bigballs'
    when 'big-balls'         then 'bigballs'
    when 'bigballsdata'      then 'bigballs'
    when 'big-balls-sports'  then 'bigballs'
    when 'bbs'               then 'bigballs'
    when 'football-data'     then 'football-data'
    when 'footballdata'      then 'football-data'
    when 'football-data-org' then 'football-data'
    when 'football_data'     then 'football-data'
    else ''
  end;
$$;

comment on function public.normalize_provider_id(text) is
  'Maps an adapter''s provider id onto the canonical id the budget ceilings are keyed by, accepting the plausible spellings of each. Returns the empty string for anything unrecognised, which every ceiling below turns into zero — fail-closed, so a typo cannot buy itself an allowance.';

-- See the header before changing a number here. The two new providers' rows are
-- KIVO's self-imposed pace, not a published limit.
drop function if exists public.provider_request_limit(text);

create or replace function public.provider_request_limit(p_provider text, p_bucket text)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select case normalize_provider_id(p_provider)
    when 'api-football' then case p_bucket
      when 'live' then 55 when 'auto' then 20 when 'daily' then 8 when 'catalogue' then 12 else 0 end
    when 'thesportsdb' then case p_bucket
      when 'live' then 55 when 'auto' then 20 when 'daily' then 8 when 'catalogue' then 12 else 0 end
    when 'bigballs' then case p_bucket
      when 'live' then 55 when 'auto' then 20 when 'daily' then 8 when 'catalogue' then 12 else 0 end
    when 'football-data' then case p_bucket
      when 'live' then 55 when 'auto' then 20 when 'daily' then 8 when 'catalogue' then 12 else 0 end
    else 0
  end;
$$;

comment on function public.provider_request_limit(text, text) is
  'The authoritative ceiling on automated provider requests for one (provider, bucket) in a rolling window. Still deliberately not an argument to consume_provider_requests — a caller that supplies its own limit decides its own ceiling. An unknown provider or bucket returns 0: a typo fails closed. The bigballs and football-data rows are KIVO''s self-imposed pace, not published provider limits, which are unreachable from the environment this was built in.';

-- Requests per 60 seconds, across every bucket. Zero means "no burst rule
-- known" and is treated as unlimited by the consume below — the honest
-- rendering of "we do not know", as opposed to a made-up number that would
-- either throttle for no reason or claim a limit that is not real.
create or replace function public.provider_request_burst_limit(p_provider text)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select case normalize_provider_id(p_provider)
    -- Published: 10 requests/minute on the free tier (docs/API_FOOTBALL.md).
    when 'api-football'  then 10
    -- Published: ~30 requests/minute on the free tier; the adapter's own cache
    -- windows were already chosen against it.
    when 'thesportsdb'   then 30
    -- Unknown from this environment. KIVO's own pace, set to the tightest it
    -- has evidence for. See this migration's header.
    when 'bigballs'      then 10
    when 'football-data' then 10
    else 0
  end;
$$;

comment on function public.provider_request_burst_limit(text) is
  'Requests per 60 seconds across all buckets of one provider. 0 means no burst rule is known and nothing is enforced — the honest rendering of an unknown limit. The api-football and thesportsdb figures are published free-tier limits; the other two are KIVO''s self-imposed pace.';

-- The return shape gains three columns, which `create or replace` cannot do to
-- an existing `returns table` — hence the drop. Every TypeScript caller reads
-- the row by column name (src/lib/football/request-budget.ts), so the added
-- columns are additive there.
drop function if exists public.consume_provider_requests(text, text, integer, integer);

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
  oldest_spend_at timestamptz,
  burst_spent integer,
  burst_limit integer,
  refusal_reason text
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
  v_burst integer;
  v_burst_limit integer;
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

  v_limit := provider_request_limit(p_provider, p_bucket);
  v_burst_limit := provider_request_burst_limit(p_provider);

  -- Two locks, always provider-wide first and per-bucket second, so callers can
  -- never take them in opposite orders and deadlock. The provider-wide one is
  -- what makes the burst count below correct across buckets; the per-bucket one
  -- is kept because 0094's invariant is stated per bucket and there is no
  -- reason to weaken it.
  perform pg_advisory_xact_lock(hashtextextended('provider_request:' || p_provider, 0));
  perform pg_advisory_xact_lock(hashtextextended('provider_request:' || p_provider || ':' || p_bucket, 0));

  v_since := now() - make_interval(secs => p_window_seconds);

  select coalesce(sum(requests), 0), min(spent_at)
    into v_spent, v_oldest
  from provider_request_spend
  where provider = p_provider
    and bucket = p_bucket
    and spent_at >= v_since;

  select coalesce(sum(requests), 0)
    into v_burst
  from provider_request_spend
  where provider = p_provider
    and spent_at >= now() - interval '60 seconds';

  if normalize_provider_id(p_provider) = '' then
    return query select false, v_spent, v_limit, v_oldest, v_burst, v_burst_limit, 'unknown_provider'::text;
    return;
  end if;

  if v_limit = 0 then
    return query select false, v_spent, v_limit, v_oldest, v_burst, v_burst_limit, 'unknown_bucket'::text;
    return;
  end if;

  if v_spent + p_count > v_limit then
    return query select false, v_spent, v_limit, v_oldest, v_burst, v_burst_limit, 'window_exhausted'::text;
    return;
  end if;

  -- A burst refusal is temporary in a way a window refusal is not: the answer
  -- is "in a moment", not "tomorrow". Named separately so a caller can say so.
  if v_burst_limit > 0 and v_burst + p_count > v_burst_limit then
    return query select false, v_spent, v_limit, v_oldest, v_burst, v_burst_limit, 'burst_exhausted'::text;
    return;
  end if;

  insert into provider_request_spend (provider, bucket, requests)
  values (p_provider, p_bucket, p_count);

  return query select true, v_spent + p_count, v_limit, coalesce(v_oldest, now()),
                      v_burst + p_count, v_burst_limit, null::text;
end;
$$;

comment on function public.consume_provider_requests(text, text, integer, integer) is
  'Atomically reserves provider requests for one (provider, bucket) against both a rolling window and a 60-second burst limit, or refuses with a named reason. Ceilings come from provider_request_limit()/provider_request_burst_limit(), never from the caller. Refusals are still never recorded.';

revoke execute on function public.consume_provider_requests(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_provider_requests(text, text, integer, integer) to service_role;
revoke execute on function public.provider_request_limit(text, text) from public, anon, authenticated;
grant execute on function public.provider_request_limit(text, text) to service_role;
revoke execute on function public.provider_request_burst_limit(text) from public, anon, authenticated;
grant execute on function public.provider_request_burst_limit(text) to service_role;
revoke execute on function public.normalize_provider_id(text) from public, anon, authenticated;
grant execute on function public.normalize_provider_id(text) to service_role;

-- To reverse:
--   drop function if exists public.consume_provider_requests(text, text, integer, integer);
--   drop function if exists public.provider_request_burst_limit(text);
--   drop function if exists public.provider_request_limit(text, text);
--   drop function if exists public.normalize_provider_id(text);
--   (then re-create 0094's single-argument provider_request_limit(text) and its
--    four-column consume_provider_requests — both are reproduced verbatim in
--    that migration)
--   drop function if exists public.prune_provider_request_log(integer);
--   drop function if exists public.prune_provider_response_cache(integer);
--   drop function if exists public.invalidate_provider_cache(text, text, text);
--   drop function if exists public.release_provider_cache_lease(text, text, text, text);
--   drop function if exists public.write_provider_cache(text, text, text, jsonb, integer, integer, text);
--   drop function if exists public.claim_provider_cache_entry(text, text, text, integer, text, boolean);
--   drop table if exists provider_request_log;
--   drop table if exists provider_response_cache;
