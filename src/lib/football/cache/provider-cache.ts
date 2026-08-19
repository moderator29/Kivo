import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";
import { logError } from "@/lib/log";
import { KivoProviderError, toKivoProviderError } from "../providers/provider-request";
import { reserveProviderRequests, type RequestBucket } from "../request-budget";
import {
  classesInvalidatedByFinishedMatch,
  resourcePolicy,
  type ResourceClass,
} from "./resource-classes";

type ServiceClient = SupabaseClient<Database>;

/**
 * The provider cache: one function that decides whether a provider request
 * happens at all, and if it does, who makes it.
 *
 * -----------------------------------------------------------------------------
 * WHY THIS IS IN THE DATABASE AND NOT IN MEMORY
 * -----------------------------------------------------------------------------
 * The obvious implementation of "two callers want the same thing, so only one
 * should fetch" is a module-level `Map` of in-flight promises. It is three lines
 * and it is a lie on this platform. A serverless function shares no memory
 * between invocations: the map is empty on every cold start, and two invocations
 * running side by side on two instances each have their own. The deduplication
 * it appears to provide is exactly the deduplication that does not happen at the
 * only moment it would have mattered — a burst.
 *
 * The only place two concurrent invocations can agree on anything is the
 * database they both already talk to. So the lease lives there
 * (`claim_provider_cache_entry`, migration 0118), taken in the same statement
 * that reads the entry, because asking "is this fresh" and "may I be the one to
 * refresh it" separately is check-then-act and lets both callers through.
 *
 * -----------------------------------------------------------------------------
 * WHAT THIS DOES THAT `next: { revalidate }` DOES NOT
 * -----------------------------------------------------------------------------
 * The per-fetch `revalidate` windows in each adapter stay exactly where they
 * are, and this sits above them rather than replacing them. They are free and
 * they deduplicate within one instance; this one costs a round trip to Postgres
 * and deduplicates across all of them. The two failures this closes and that
 * one cannot:
 *
 *   * A cold start always misses. Every deploy, every scale-out, every idle
 *     period ends with a full-price fetch of things that had not changed.
 *   * `revalidate` has one deadline, not two. After it, there is a fetch; there
 *     is no state in which the old answer is served while a new one is fetched,
 *     so a provider outage becomes an empty screen even though a four-minute-old
 *     answer was available.
 *
 * -----------------------------------------------------------------------------
 * AND WHAT IT DOES THAT NEITHER OF THEM DOES: SPEND THE BUDGET
 * -----------------------------------------------------------------------------
 * A cache miss is not permission to make a request. The resource class names a
 * budget bucket, and the reservation happens here, after the lease is won and
 * before the fetcher runs — which is the only ordering that cannot spend a
 * request the ledger does not know about. A refused reservation falls back to
 * stale data if there is any, because a slightly old league table is a much
 * better answer than an exhausted quota.
 */

export type CacheState = "fresh" | "stale" | "expired" | "miss";

export interface CachedResult<T> {
  value: T;
  /** Where the returned value came from. `fresh` means no provider request was
   * made; `miss` means one was and it succeeded. */
  state: CacheState;
  /** When the value was retrieved from the provider. Null only for a value that
   * has just been fetched by this call and not yet re-read. */
  fetchedAt: string | null;
  /** True when the value is older than its policy wanted and is being served
   * anyway — because a refresh failed, was refused by the budget, or is being
   * done by somebody else right now. Surfaces so a caller can label it; never
   * silently. */
  servedStale: boolean;
}

export interface FetchContext {
  /** What the cache found before deciding to fetch. Worth passing to telemetry:
   * a request made on a `miss` and one made on a `stale` are different events. */
  cacheState: CacheState;
  /** This attempt's lease id, for correlating logs. */
  attemptId: string;
}

export interface WithProviderCacheOptions<T> {
  supabase: ServiceClient;
  /** Canonical provider id — the same string the budget ledger and the
   * telemetry log are keyed by. */
  provider: string;
  resourceClass: ResourceClass;
  /** Identifies the specific resource within the class. Build it from stable
   * ids, never from a whole URL: a URL can carry a key, and a key must never
   * become a primary-key column. */
  key: string;
  fetcher: (context: FetchContext) => Promise<T>;
  /** An operator's explicit "refresh now". Bypasses freshness but NOT the
   * budget — a human pressing a button still spends real quota, and pretending
   * otherwise is how a supervised action empties a day's allowance. */
  force?: boolean;
  /** How long this attempt holds the right to fetch before the lease expires
   * and somebody else may try. Should comfortably exceed the transport's own
   * timeout, or a slow-but-alive fetch gets overtaken. */
  leaseSeconds?: number;
  /** How long to wait for another caller's in-flight fetch when there is
   * nothing cached to serve in the meantime. */
  waitForLeaderMs?: number;
  /** How many requests this fetch will make, if it is more than one. Reserved
   * together so the ledger cannot under-count a burst. */
  requestCount?: number;
}

const DEFAULT_LEASE_SECONDS = 30;
const DEFAULT_WAIT_FOR_LEADER_MS = 3_000;
const LEADER_POLL_INTERVAL_MS = 200;

/**
 * Reads through the cache, fetching at most once across every concurrent caller.
 *
 * The decision tree, in the order it is applied:
 *
 *   1. Fresh, and not forced → return it. No request, no budget spend.
 *   2. This caller won the lease → reserve budget, fetch, store, return.
 *      A failed fetch releases the lease and falls back to whatever is cached,
 *      however old, rather than propagating the failure to a page.
 *   3. Somebody else holds the lease and something is cached → return that
 *      immediately. This is the stale-while-revalidate case and the caller does
 *      NOT wait: the whole point is that the refresh is somebody else's problem.
 *   4. Somebody else holds the lease and nothing is cached → wait briefly for
 *      their answer, then give up. Deliberately does not fetch: overtaking the
 *      leader would spend a second request for one answer, which is the exact
 *      thing this function exists to prevent.
 */
export async function withProviderCache<T>(options: WithProviderCacheOptions<T>): Promise<CachedResult<T>> {
  const {
    supabase,
    provider,
    resourceClass,
    key,
    fetcher,
    force = false,
    leaseSeconds = DEFAULT_LEASE_SECONDS,
    waitForLeaderMs = DEFAULT_WAIT_FOR_LEADER_MS,
    requestCount = 1,
  } = options;

  const policy = resourcePolicy(resourceClass);
  const attemptId = newAttemptId();

  const claim = await claimEntry(supabase, provider, resourceClass, key, leaseSeconds, attemptId, force);

  // 1. Fresh. The cheapest possible answer and the one this whole file exists
  //    to produce as often as possible.
  if (claim.state === "fresh" && !claim.mayFetch && claim.payload !== null) {
    return { value: claim.payload as T, state: "fresh", fetchedAt: claim.fetchedAt, servedStale: false };
  }

  // 2. This caller is the one making the request.
  if (claim.mayFetch) {
    const reservation = await reserveBudget(supabase, provider, policy.bucket, requestCount);

    if (!reservation.allowed) {
      await releaseLease(supabase, provider, resourceClass, key, attemptId);
      const fallback = servableFallback<T>(claim);
      if (fallback) {
        // A refused budget with something cached is not a failure. It is the
        // budget doing its job while the product keeps working.
        return fallback;
      }
      throw new KivoProviderError(
        `${provider}: refused by KIVO's own request budget (${reservation.reason ?? "no allowance left"}) before requesting ${resourceClass}:${key}. Nothing cached to serve instead.`,
        { provider, kind: "rate_limited" },
      );
    }

    try {
      const value = await fetcher({ cacheState: claim.state, attemptId });
      await storeEntry(supabase, provider, resourceClass, key, value, policy.freshSeconds, policy.staleSeconds, attemptId);
      return { value, state: claim.state, fetchedAt: new Date().toISOString(), servedStale: false };
    } catch (err) {
      await releaseLease(supabase, provider, resourceClass, key, attemptId);
      const fallback = servableFallback<T>(claim);
      if (fallback) {
        // The outage case. Something old beats nothing, and the failure is not
        // swallowed — it is logged here and recorded in provider_request_log by
        // the transport, so Admin sees a provider in trouble while the product
        // keeps showing football.
        logError("football.providerCache.servedStaleAfterFailure", err, { provider, resourceClass, key });
        return fallback;
      }
      throw toKivoProviderError(err, provider);
    }
  }

  // 3. Somebody else is refreshing and there is something to serve. Do not wait
  //    for them — that would turn a background refresh into a foreground one.
  const immediate = servableFallback<T>(claim);
  if (immediate) return immediate;

  // 4. Somebody else is refreshing and there is nothing to serve. Wait for their
  //    answer rather than making a second request for it.
  const waited = await waitForLeader<T>(supabase, provider, resourceClass, key, waitForLeaderMs);
  if (waited) return waited;

  throw new KivoProviderError(
    `${provider}: another request for ${resourceClass}:${key} was already in flight and did not return within ${waitForLeaderMs}ms. KIVO does not overtake an in-flight request — that spends a second provider request for one answer.`,
    { provider, kind: "timeout" },
  );
}

/**
 * Expires every cached entry a finished match makes wrong.
 *
 * Called after a match reaches full time. Which classes are affected is declared
 * by the classes themselves (`invalidatedByFinishedMatch`), not listed here, so
 * enrolling a new one is a one-line change in `resource-classes.ts`.
 *
 * Expires rather than deletes, deliberately: until the new league table arrives,
 * the old one is still the best answer available, and deleting it would turn an
 * 89th-minute goal into an empty screen.
 *
 * `keyPrefix` scopes the invalidation to the competition that actually played —
 * without it, one match in one league expires every league's table. Callers that
 * cannot compute a prefix may omit it and pay for the over-invalidation
 * knowingly.
 */
export async function invalidateOnMatchCompletion(
  supabase: ServiceClient,
  provider: string,
  keyPrefix?: string,
): Promise<number> {
  let total = 0;
  for (const resourceClass of classesInvalidatedByFinishedMatch()) {
    const { data, error } = await supabase.rpc("invalidate_provider_cache", {
      p_provider: provider,
      p_resource_class: resourceClass,
      p_key_prefix: keyPrefix ?? undefined,
    });
    if (error) {
      // Best effort by contract. A failure to invalidate means a table stays
      // fresh for up to its TTL — stale, not wrong-shaped — and is never worth
      // failing a sync over.
      logError("football.providerCache.invalidate", error, { provider, resourceClass });
      continue;
    }
    total += typeof data === "number" ? data : 0;
  }
  return total;
}

/** Bounded retention sweep, for the scheduled worker's janitor step alongside
 * `pruneProviderRequestSpend`. Best effort: a cache that fails to prune is a
 * table that grows slowly. */
export async function pruneProviderCache(supabase: ServiceClient): Promise<number> {
  const { data, error } = await supabase.rpc("prune_provider_response_cache", { p_max_rows: 2000 });
  if (error) {
    logError("football.providerCache.prune", error);
    return 0;
  }
  return typeof data === "number" ? data : 0;
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

interface ClaimResult {
  state: CacheState;
  payload: unknown;
  fetchedAt: string | null;
  mayFetch: boolean;
}

function newAttemptId(): string {
  // randomUUID is available on every runtime this ships to. The id only has to
  // be unique among concurrent holders of one key, so there is no need for
  // anything stronger.
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function claimEntry(
  supabase: ServiceClient,
  provider: string,
  resourceClass: ResourceClass,
  key: string,
  leaseSeconds: number,
  attemptId: string,
  force: boolean,
): Promise<ClaimResult> {
  const { data, error } = await supabase.rpc("claim_provider_cache_entry", {
    p_provider: provider,
    p_resource_class: resourceClass,
    p_cache_key: key,
    p_lease_seconds: leaseSeconds,
    p_owner: attemptId,
    p_force: force,
  });

  if (error) {
    // An unreachable cache must NOT block football. This is the opposite
    // direction from the request budget, which fails closed, and the difference
    // is what each failure costs: a budget that fails open spends the account's
    // quota with nothing recording it, while a cache that fails closed takes the
    // product down to protect an optimisation. So this degrades to "miss, and
    // you may fetch" — every caller pays full price, which is exactly what the
    // product did before this table existed.
    logError("football.providerCache.claim", error, { provider, resourceClass, key });
    return { state: "miss", payload: null, fetchedAt: null, mayFetch: true };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { state: "miss", payload: null, fetchedAt: null, mayFetch: true };

  return {
    state: (row.state as CacheState) ?? "miss",
    payload: row.payload ?? null,
    fetchedAt: row.fetched_at ?? null,
    mayFetch: Boolean(row.may_fetch),
  };
}

async function reserveBudget(
  supabase: ServiceClient,
  provider: string,
  bucket: RequestBucket | null,
  count: number,
): Promise<{ allowed: boolean; reason: string | null }> {
  // A null bucket is a class only an operator's explicit action fetches. Those
  // are deliberately outside every automated allowance (migration 0094): the
  // headroom left over is what guarantees a human debugging always has room.
  if (bucket === null) return { allowed: true, reason: null };
  const decision = await reserveProviderRequests(supabase, provider, bucket, count);
  return { allowed: decision.allowed, reason: decision.refusalReason };
}

async function storeEntry(
  supabase: ServiceClient,
  provider: string,
  resourceClass: ResourceClass,
  key: string,
  value: unknown,
  freshSeconds: number,
  staleSeconds: number,
  attemptId: string,
): Promise<void> {
  const { error } = await supabase.rpc("write_provider_cache", {
    p_provider: provider,
    p_resource_class: resourceClass,
    p_cache_key: key,
    p_payload: value as Json,
    p_fresh_seconds: freshSeconds,
    p_stale_seconds: staleSeconds,
    p_owner: attemptId,
  });
  if (error) {
    // The request already happened and the caller already has its answer.
    // Failing here would throw away a paid-for response to report a caching
    // problem, which is the wrong trade in every direction.
    logError("football.providerCache.write", error, { provider, resourceClass, key });
  }
}

async function releaseLease(
  supabase: ServiceClient,
  provider: string,
  resourceClass: ResourceClass,
  key: string,
  attemptId: string,
): Promise<void> {
  const { error } = await supabase.rpc("release_provider_cache_lease", {
    p_provider: provider,
    p_resource_class: resourceClass,
    p_cache_key: key,
    p_owner: attemptId,
  });
  if (error) {
    // Not fatal: the lease expires on its own. This only makes the next caller
    // wait out the remainder instead of trying immediately.
    logError("football.providerCache.release", error, { provider, resourceClass, key });
  }
}

/**
 * Whatever is cached, if it is good enough to hand back.
 *
 * `expired` counts. That is the deliberate part: past its stale window the value
 * is no longer good enough to serve on a normal path, but this function is only
 * reached when the alternative is nothing at all — a failed fetch, a refused
 * budget, or somebody else's in-flight request. In that situation an old answer
 * flagged as old beats an error page, and the flag is what keeps it honest.
 */
function servableFallback<T>(claim: ClaimResult): CachedResult<T> | null {
  if (claim.payload === null || claim.payload === undefined) return null;
  return {
    value: claim.payload as T,
    state: claim.state,
    fetchedAt: claim.fetchedAt,
    servedStale: claim.state !== "fresh",
  };
}

/**
 * Waits for whoever holds the lease to write their answer.
 *
 * Polling rather than listening, because `LISTEN/NOTIFY` needs a persistent
 * connection and this runs behind a connection pooler on a serverless function
 * — the one place a long-lived listener cannot exist. The wait is short and
 * bounded, and giving up is a normal outcome, not an error state: the caller
 * above turns it into a normalized error whose user-facing sentence is the
 * ordinary "temporarily unavailable".
 */
async function waitForLeader<T>(
  supabase: ServiceClient,
  provider: string,
  resourceClass: ResourceClass,
  key: string,
  waitForLeaderMs: number,
): Promise<CachedResult<T> | null> {
  const deadline = Date.now() + waitForLeaderMs;
  while (Date.now() < deadline) {
    await sleep(LEADER_POLL_INTERVAL_MS);
    const { data, error } = await supabase
      .from("provider_response_cache")
      .select("payload, fetched_at, fresh_until")
      .eq("provider", provider)
      .eq("resource_class", resourceClass)
      .eq("cache_key", key)
      .maybeSingle();

    if (error) {
      logError("football.providerCache.waitForLeader", error, { provider, resourceClass, key });
      return null;
    }
    if (data?.payload !== null && data?.payload !== undefined) {
      const fresh = data.fresh_until !== null && new Date(data.fresh_until).getTime() > Date.now();
      return {
        value: data.payload as T,
        state: fresh ? "fresh" : "stale",
        fetchedAt: data.fetched_at,
        servedStale: !fresh,
      };
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
