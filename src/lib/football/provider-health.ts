import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { logError } from "@/lib/log";
import { RESOURCE_POLICIES, type ResourceClass } from "./cache/resource-classes";
import { readBudgetUsage, type BucketUsage } from "./request-budget";

type ServiceClient = SupabaseClient<Database>;

/**
 * Everything the Admin provider page shows, read from real rows.
 *
 * -----------------------------------------------------------------------------
 * THE TWO RULES THIS FILE IS BUILT AROUND
 * -----------------------------------------------------------------------------
 * **Never fabricate a number.** Every field that could be unknown is typed
 * `| null` and stays null when nothing measured it. There is no `?? 0` anywhere
 * in this file, and that is not an oversight to be tidied — a zero renders as a
 * fact. An unmeasured latency shown as 0ms is a claim that the provider answers
 * instantly, and it is the most flattering possible lie about a provider that
 * is not answering at all.
 *
 * **A check the viewer cannot read must not be run.** Every table below is RLS
 * on with no policies, reachable only by the service-role client. Running these
 * for somebody whose role does not cover football data would return zero rows —
 * and zero failed syncs, zero errors and zero stale entries all render as "all
 * clear". So the capability is a required argument, checked before the first
 * query, and a caller without it gets a refusal rather than a reassuring empty
 * page.
 */

/** Proof the caller checked the role. A boolean rather than an optional flag so
 * it cannot be forgotten, and named for what it asserts rather than for what it
 * permits. */
export interface ProviderHealthAccess {
  canManageFootballData: boolean;
}

/**
 * KIVO's declared provider order.
 *
 * This describes CONFIGURATION — which credentials exist and which slot each
 * provider occupies — not which class `getFootballDataProvider()` happens to
 * construct. The distinction matters and is why this does not import that
 * function: the two answer different questions, and a page that conflates them
 * shows "connected" while every request is being refused, which is precisely
 * the failure that made this page necessary on 2026-08-19.
 */
export type ProviderSlot = "primary" | "secondary" | "legacy";

export interface ProviderConfiguration {
  id: string;
  label: string;
  /** The server-only environment variable that carries this provider's key.
   * Never `NEXT_PUBLIC_` — a football key in a client bundle is a key anybody
   * can read and spend. */
  envVar: string;
  slot: ProviderSlot;
  /** Whether the variable is set. Never the value, never a prefix of it, never
   * a length — none of which any screen needs and all of which narrow a guess. */
  credentialPresent: boolean;
}

/**
 * The order, written once.
 *
 * Big Balls Sports Data is primary and football-data.org is secondary per the
 * founder's directive of 2026-08-19. API-Football is demoted rather than
 * removed: its free plan refuses the current season, which is the reason the
 * live product shows no players and no standings, but it is still the provider
 * every existing mapping in the database was built against.
 */
export const PROVIDER_CONFIGURATION_ORDER: readonly Omit<ProviderConfiguration, "credentialPresent">[] = [
  { id: "bigballs", label: "Big Balls Sports Data", envVar: "BBS_API_KEY", slot: "primary" },
  { id: "football-data", label: "football-data.org", envVar: "FOOTBALL_DATA_API_KEY", slot: "secondary" },
  { id: "api-football", label: "API-Football", envVar: "API_FOOTBALL_KEY", slot: "legacy" },
  { id: "thesportsdb", label: "TheSportsDB", envVar: "THE_SPORTS_DB_API_KEY", slot: "legacy" },
];

export function readProviderConfiguration(): ProviderConfiguration[] {
  return PROVIDER_CONFIGURATION_ORDER.map((provider) => ({
    ...provider,
    // Blank-but-set counts as absent. A variable set to "" in a dashboard is
    // the single most common way a key looks configured and is not.
    credentialPresent: (process.env[provider.envVar] ?? "").trim().length > 0,
  }));
}

/**
 * The health verdict.
 *
 * `unknown` is a first-class outcome and the most important one in this union.
 * A provider nobody has called yet is not healthy — it is untested, and the two
 * look identical on a dashboard that only has green and red. Every screen that
 * renders this must render `unknown` as its own thing.
 */
export type ProviderHealthVerdict = "healthy" | "degraded" | "failing" | "unknown";

export interface ProviderLatency {
  /** How many measured samples the figures below are drawn from. Zero means
   * every figure beside it is null. */
  sampleCount: number;
  medianMs: number | null;
  p95Ms: number | null;
  slowestMs: number | null;
  /** True when the sample hit the query's row cap, so the figures describe the
   * most recent N requests rather than the whole window. Shown, not hidden — a
   * percentile over a truncated sample is a different claim. */
  sampleTruncated: boolean;
}

export interface ProviderErrorTally {
  kind: string;
  count: number;
  lastAt: string;
  /** The most recent operator-facing message for this kind, already redacted at
   * the point it was stored. */
  lastMessage: string | null;
}

export interface ProviderCacheClassSummary {
  resourceClass: ResourceClass | string;
  entries: number;
  fresh: number;
  stale: number;
  expired: number;
  /** The most recent successful retrieval in this class — the honest answer to
   * "how fresh is our football". Null when the class has never been cached. */
  newestFetchedAt: string | null;
  oldestFetchedAt: string | null;
  /** Times an entry in this class was served without a provider request. The
   * only number here that says whether the cache is earning its keep. */
  servedCount: number;
  /** The policy's own one-line justification, so a window can be judged on the
   * page without opening resource-classes.ts. */
  freshSeconds: number | null;
  rationale: string | null;
}

export interface FailedSyncJob {
  id: string;
  entityType: string;
  startedAt: string;
  finishedAt: string | null;
  message: string | null;
}

export interface ProviderHealthReport {
  provider: string;
  verdict: ProviderHealthVerdict;
  windowHours: number;
  requestCount: number;
  successCount: number;
  errorCount: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureKind: string | null;
  lastFailureMessage: string | null;
  latency: ProviderLatency;
  /** The provider's own remaining-request count, from the most recent response
   * that carried one. Null when no response has ever carried one — which for a
   * provider that does not send such a header is permanent and correct. */
  quotaRemaining: number | null;
  quotaRemainingAt: string | null;
  budgets: BucketUsage[];
  errors: ProviderErrorTally[];
}

export interface ProviderPlatformReport {
  configuration: ProviderConfiguration[];
  /** First configured provider in declared order, or null when none is. Named
   * "configured" rather than "active" on purpose: this file reads environment
   * variables, and only `getFootballDataProvider()` can say what was actually
   * constructed. */
  configuredPrimary: ProviderConfiguration | null;
  configuredFallback: ProviderConfiguration | null;
  health: ProviderHealthReport[];
  cache: ProviderCacheClassSummary[];
  cacheTotalEntries: number;
  failedSyncJobs: FailedSyncJob[];
  /** True when the report was assembled without any of its queries failing.
   * A partially-read report is labelled as one rather than shown as a complete
   * picture with holes in it. */
  complete: boolean;
}

const HEALTH_WINDOW_HOURS = 24;
const REQUEST_SAMPLE_CAP = 1_000;

/**
 * Reads the whole provider picture.
 *
 * Refuses without the capability rather than returning an empty report, because
 * an empty report from this function is indistinguishable from a healthy system
 * and would be read as one.
 */
export async function readProviderPlatformReport(
  supabase: ServiceClient,
  access: ProviderHealthAccess,
): Promise<ProviderPlatformReport | null> {
  if (!access.canManageFootballData) return null;

  const configuration = readProviderConfiguration();
  const present = configuration.filter((entry) => entry.credentialPresent);

  // Health is only read for providers that could plausibly have made a request:
  // one that has never been configured has no rows, and rendering an empty
  // health card for it would put three "no requests recorded" panels next to the
  // one that matters.
  const providersToInspect = present.length > 0 ? present.map((entry) => entry.id) : [];

  let complete = true;
  const fail = (context: string, error: unknown) => {
    complete = false;
    logError(context, error);
  };

  const [health, cache, failedSyncJobs] = await Promise.all([
    Promise.all(providersToInspect.map((provider) => readProviderHealth(supabase, provider, fail))),
    readCacheSummary(supabase, fail),
    readFailedSyncJobs(supabase, fail),
  ]);

  return {
    configuration,
    configuredPrimary: present[0] ?? null,
    configuredFallback: present[1] ?? null,
    health,
    cache: cache.classes,
    cacheTotalEntries: cache.total,
    failedSyncJobs,
    complete,
  };
}

async function readProviderHealth(
  supabase: ServiceClient,
  provider: string,
  fail: (context: string, error: unknown) => void,
): Promise<ProviderHealthReport> {
  const since = new Date(Date.now() - HEALTH_WINDOW_HOURS * 3_600_000).toISOString();

  const [logResult, quotaResult, budgets] = await Promise.all([
    supabase
      .from("provider_request_log")
      .select("outcome, error_kind, http_status, latency_ms, message, occurred_at")
      .eq("provider", provider)
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .limit(REQUEST_SAMPLE_CAP),
    // The latest quota reading is deliberately NOT window-scoped. A provider
    // that has been quiet for two days still last told us a number, and "no
    // reading in the last 24 hours" is not the same statement as "no reading".
    supabase
      .from("provider_request_log")
      .select("quota_remaining, occurred_at")
      .eq("provider", provider)
      .not("quota_remaining", "is", null)
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    readBudgetUsage(supabase, provider),
  ]);

  if (logResult.error) fail("football.providerHealth.log", logResult.error);
  if (quotaResult.error) fail("football.providerHealth.quota", quotaResult.error);

  const rows = logResult.data ?? [];
  const successes = rows.filter((row) => row.outcome === "success");
  const failures = rows.filter((row) => row.outcome === "error");

  const latencies = successes
    .map((row) => row.latency_ms)
    .filter((value): value is number => typeof value === "number");

  const lastFailure = failures[0] ?? null;

  return {
    provider,
    verdict: verdictFor(rows.length, successes.length, failures.length, rows[0]?.outcome ?? null),
    windowHours: HEALTH_WINDOW_HOURS,
    requestCount: rows.length,
    successCount: successes.length,
    errorCount: failures.length,
    lastSuccessAt: successes[0]?.occurred_at ?? null,
    lastFailureAt: lastFailure?.occurred_at ?? null,
    lastFailureKind: lastFailure?.error_kind ?? null,
    lastFailureMessage: lastFailure?.message ?? null,
    latency: summariseLatency(latencies, rows.length >= REQUEST_SAMPLE_CAP),
    quotaRemaining: quotaResult.data?.quota_remaining ?? null,
    quotaRemainingAt: quotaResult.data?.occurred_at ?? null,
    budgets,
    errors: tallyErrors(failures),
  };
}

/**
 * The verdict, from counts alone.
 *
 * The thresholds are judgment and are stated rather than hidden: a fifth of
 * requests failing is degraded, half is failing, and the most recent request
 * failing outright drops a provider at least to degraded regardless of the ratio
 * — because a provider that is broken right now is not healthy on the strength
 * of having worked earlier.
 */
function verdictFor(
  total: number,
  successes: number,
  failures: number,
  mostRecentOutcome: string | null,
): ProviderHealthVerdict {
  if (total === 0) return "unknown";
  const failureRate = failures / total;
  if (failureRate >= 0.5) return "failing";
  if (failureRate >= 0.2) return "degraded";
  if (mostRecentOutcome === "error") return "degraded";
  if (successes === 0) return "failing";
  return "healthy";
}

/**
 * Percentiles over whatever was actually measured.
 *
 * Returns nulls rather than zeros for an empty sample, and the median rather
 * than the mean: one twelve-second timeout drags a mean into fiction while the
 * median keeps saying what a normal request costs. p95 is carried beside it
 * because the tail is the thing that times a serverless function out, and a
 * median alone would hide it.
 */
function summariseLatency(samples: number[], truncated: boolean): ProviderLatency {
  if (samples.length === 0) {
    return { sampleCount: 0, medianMs: null, p95Ms: null, slowestMs: null, sampleTruncated: truncated };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
  return {
    sampleCount: sorted.length,
    medianMs: at(0.5),
    p95Ms: at(0.95),
    slowestMs: sorted[sorted.length - 1],
    sampleTruncated: truncated,
  };
}

function tallyErrors(failures: { error_kind: string | null; message: string | null; occurred_at: string }[]): ProviderErrorTally[] {
  const byKind = new Map<string, ProviderErrorTally>();
  for (const row of failures) {
    // The table's own constraint guarantees an error row has a kind; this is the
    // type system catching up rather than a real branch.
    const kind = row.error_kind ?? "client_error";
    const existing = byKind.get(kind);
    if (existing) {
      existing.count += 1;
      continue;
    }
    // Rows arrive newest-first, so the first of each kind is the most recent.
    byKind.set(kind, { kind, count: 1, lastAt: row.occurred_at, lastMessage: row.message });
  }
  return [...byKind.values()].sort((a, b) => b.count - a.count);
}

async function readCacheSummary(
  supabase: ServiceClient,
  fail: (context: string, error: unknown) => void,
): Promise<{ classes: ProviderCacheClassSummary[]; total: number }> {
  const { data, error } = await supabase
    .from("provider_response_cache")
    .select("resource_class, fetched_at, fresh_until, stale_until, served_count, payload")
    .not("payload", "is", null)
    .limit(5_000);

  if (error) {
    fail("football.providerHealth.cache", error);
    return { classes: [], total: 0 };
  }

  const now = Date.now();
  const byClass = new Map<string, ProviderCacheClassSummary>();

  for (const row of data ?? []) {
    const key = row.resource_class;
    const policy = RESOURCE_POLICIES[key as ResourceClass];
    const summary =
      byClass.get(key) ??
      ({
        resourceClass: key,
        entries: 0,
        fresh: 0,
        stale: 0,
        expired: 0,
        newestFetchedAt: null,
        oldestFetchedAt: null,
        servedCount: 0,
        // Null rather than a guess when a class in the database has no policy in
        // code — which would mean somebody cached something the policy table
        // does not know about, and inventing a window for it would hide that.
        freshSeconds: policy?.freshSeconds ?? null,
        rationale: policy?.rationale ?? null,
      } satisfies ProviderCacheClassSummary);

    summary.entries += 1;
    summary.servedCount += row.served_count;

    const freshUntil = row.fresh_until ? new Date(row.fresh_until).getTime() : null;
    const staleUntil = row.stale_until ? new Date(row.stale_until).getTime() : null;
    if (freshUntil !== null && now < freshUntil) summary.fresh += 1;
    else if (staleUntil !== null && now < staleUntil) summary.stale += 1;
    else summary.expired += 1;

    if (row.fetched_at) {
      if (summary.newestFetchedAt === null || row.fetched_at > summary.newestFetchedAt) {
        summary.newestFetchedAt = row.fetched_at;
      }
      if (summary.oldestFetchedAt === null || row.fetched_at < summary.oldestFetchedAt) {
        summary.oldestFetchedAt = row.fetched_at;
      }
    }

    byClass.set(key, summary);
  }

  const classes = [...byClass.values()].sort((a, b) => b.entries - a.entries);
  return { classes, total: classes.reduce((sum, entry) => sum + entry.entries, 0) };
}

async function readFailedSyncJobs(
  supabase: ServiceClient,
  fail: (context: string, error: unknown) => void,
): Promise<FailedSyncJob[]> {
  const since = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();
  const { data, error } = await supabase
    .from("sync_runs")
    .select("id, entity_type, started_at, finished_at, error_message, status")
    .eq("status", "failed")
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(10);

  if (error) {
    fail("football.providerHealth.failedSyncs", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    entityType: row.entity_type,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    message: row.error_message,
  }));
}
