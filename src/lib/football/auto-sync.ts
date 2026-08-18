import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";
import { getActiveProviderStatus } from "./index";
import { syncTodayFixtures } from "./sync";

/**
 * Automatic, on-demand football data freshness — the thing that makes KIVO
 * populate itself without anybody pressing a button (founder instruction,
 * 2026-08-18: "Make it automatic — no need for triggering now").
 *
 * ## Why this exists rather than just a schedule
 *
 * Every sync this platform has ever run started with an admin clicking
 * something, which is why `sync_runs` was empty and every football surface
 * rendered its honest empty state all day. The obvious fix is a scheduler, and
 * two are now wired up — but both need something from the founder first: the
 * Vercel daily cron needs a deployment, and the once-a-minute Supabase pg_cron
 * job needs two Vault secrets and the `FOOTBALL_LIVE_POLLING_ENABLED` flag.
 *
 * This path needs nothing. It runs on the deployment that already exists, with
 * the `API_FOOTBALL_KEY` that is already set. Somebody opening /matches on a
 * database whose fixtures are three hours stale *is* the trigger.
 *
 * ## What it is not
 *
 * **This is not live scores.** Read that sentence again before describing this
 * feature to anyone. Data refreshes when somebody looks at a page and it is
 * already stale, which means: the first visitor after a gap sees the old data
 * and the *next* visitor sees the new data. On a quiet site nothing refreshes
 * at all. Minute-by-minute score updates need the once-a-minute worker, which
 * needs a Vercel plan that permits it or the pg_cron path armed — see
 * `DECISIONS.md` and `docs/LIVE_DATA.md`.
 *
 * ## How it stays cheap and safe
 *
 * Every guard below exists because the failure mode it prevents is real on a
 * 100-requests-per-day free tier:
 *
 * 1. **After the response, never during it.** `after()` (Next.js) runs the work
 *    once the response has been sent, so a provider call can never delay a
 *    render or turn a slow vendor into a slow page. If the provider is down,
 *    the page is unaffected.
 * 2. **A staleness threshold per surface.** /live is worth refreshing far more
 *    often than a league table. A surface asks for what it needs.
 * 3. **A cooldown independent of the threshold.** Without it, a *failing* sync
 *    would be retried by every single page view, and 100 requests would be gone
 *    in a minute. The cooldown counts attempts, not successes.
 * 4. **The sync lease** (migration 0056). Ten people loading /matches at once
 *    produce one sync, not ten — checked here to avoid even writing a run row,
 *    and enforced properly by the atomic claim inside `syncTodayFixtures`.
 * 5. **The quota floor**, the same absolute threshold the cron worker and Data
 *    Health's amber pill already use, so a human debugging with "Sync now"
 *    always has room left that automation will not spend.
 * 6. **Never throws.** This is invisible background work attached to somebody
 *    else's page view; a failure belongs in a log and a `sync_runs` row.
 *
 * Deliberately NOT gated on `FOOTBALL_LIVE_POLLING_ENABLED`. That flag is the
 * founder's protection against the *once-a-minute* worker burning a free tier,
 * and it stays untouched and unread here — this path's own bound is traffic
 * plus a cooldown, which is a completely different risk. Flipping that flag
 * from code is forbidden and nothing here does it.
 */

export type AutoSyncSurface = "live" | "matches" | "browse";

/**
 * How stale the data has to be before a page view is worth a provider call.
 *
 * These are budget decisions, not guesses. API-Football's free tier is 100
 * requests a day (docs/API_FOOTBALL.md). At the "live" threshold, a page being
 * watched continuously costs at most 20 requests an hour — which is why the
 * cooldown below, not this number, is what actually bounds the spend.
 */
const STALENESS_MINUTES: Record<AutoSyncSurface, number> = {
  /** /live and an in-progress Match Centre: the surfaces where stale is most visible. */
  live: 3,
  /** /matches and /home: a scoreline a few minutes old is fine. */
  matches: 15,
  /** Team, player, league and venue pages: reference data that barely moves. */
  browse: 180,
};

/**
 * Minimum gap between *attempts*, whatever their outcome, across all surfaces.
 *
 * This is the guard that actually protects the quota, and it is separate from
 * the thresholds above on purpose. A sync that fails leaves the data exactly as
 * stale as it was, so a threshold alone would make every subsequent page view
 * try again — and a hundred page views is a hundred requests, which is the
 * entire daily budget, spent on the same failure.
 */
const ATTEMPT_COOLDOWN_MINUTES = 3;

/**
 * Matches QUOTA_SAFETY_FLOOR in src/app/api/cron/sync-live/route.ts and the
 * amber threshold on Data Health's "requests left today" pill. Kept the same
 * number deliberately: an admin who has seen that pill go amber already knows,
 * without reading this file, that automation has stopped spending.
 */
const QUOTA_SAFETY_FLOOR = 10;

/**
 * Schedules a fixtures sync after this response, if the data is stale enough to
 * justify one. Safe to call from any Server Component; returns immediately and
 * never throws.
 *
 * Call it, do not await it — the work it schedules is deliberately outside the
 * request.
 */
export function scheduleAutoSyncIfStale(surface: AutoSyncSurface): void {
  after(async () => {
    try {
      await runAutoSyncIfStale(surface);
    } catch (error) {
      // `after` swallows nothing by itself, and an unhandled rejection in a
      // background task is a noisy way to learn about a provider outage.
      logError("football.autoSync", error, { surface });
    }
  });
}

export type AutoSyncDecision =
  | { decision: "no_provider" }
  | { decision: "fresh"; ageMinutes: number }
  | { decision: "cooling_down" }
  | { decision: "already_running" }
  | { decision: "quota_floor"; quotaRemaining: number }
  | { decision: "synced"; recordsProcessed: number }
  | { decision: "unavailable" };

/**
 * What the caller sees of the outside world. Injectable purely so the guard
 * ladder above can be tested — the guards are what protect a 100-request-a-day
 * budget, and "we reasoned about it carefully" is a weaker guarantee than a
 * test that a failing sync does not get retried by every page view.
 *
 * Every field defaults to the real thing, so production callers pass nothing.
 */
export type AutoSyncDeps = {
  providerName: string | null;
  supabase: SupabaseClient<Database> | null;
  now: number;
  syncFixtures: () => Promise<{ recordsProcessed: number }>;
};

/** The decision, extracted so it can be reasoned about (and tested) without a
 * request context. Returns what it decided, for logging. */
export async function runAutoSyncIfStale(
  surface: AutoSyncSurface,
  deps?: Partial<AutoSyncDeps>,
): Promise<AutoSyncDecision> {
  // Side-effect-free: never constructs a provider client (and so never spends
  // anything) just to find out whether one is configured.
  const providerName = deps?.providerName !== undefined ? deps.providerName : getActiveProviderStatus().name;
  if (!providerName) return { decision: "no_provider" };

  let supabase: SupabaseClient<Database>;
  if (deps?.supabase !== undefined) {
    if (deps.supabase === null) return { decision: "unavailable" };
    supabase = deps.supabase;
  } else {
    try {
      supabase = createServiceRoleSupabaseClient();
    } catch (error) {
      // Missing service-role key. Same degradation as everywhere else that
      // touches this client: log, do nothing, never break the page.
      logError("football.autoSync.clientUnavailable", error, { surface });
      return { decision: "unavailable" };
    }
  }

  // Two questions, one round trip each, both cheap and both indexed.
  const [{ data: lastSuccess }, { data: lastAttempt }] = await Promise.all([
    // Freshness: only a run that actually refreshed data counts. A failed run
    // left the data exactly as stale as it found it.
    supabase
      .from("sync_runs")
      .select("last_synced_at")
      .eq("entity_type", "fixture")
      .in("status", ["success", "partial"])
      .not("last_synced_at", "is", null)
      .order("last_synced_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Cooldown: every run counts, including the failures — that is the point.
    supabase
      .from("sync_runs")
      .select("started_at")
      .eq("entity_type", "fixture")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const now = deps?.now ?? Date.now();

  if (lastAttempt?.started_at) {
    const sinceAttemptMinutes = (now - new Date(lastAttempt.started_at).getTime()) / 60_000;
    if (sinceAttemptMinutes < ATTEMPT_COOLDOWN_MINUTES) return { decision: "cooling_down" };
  }

  // No successful sync ever means the database is empty, which is the case this
  // whole mechanism exists for — treat it as infinitely stale rather than
  // skipping it, or a brand-new deployment would stay empty forever.
  if (lastSuccess?.last_synced_at) {
    const ageMinutes = (now - new Date(lastSuccess.last_synced_at).getTime()) / 60_000;
    if (ageMinutes < STALENESS_MINUTES[surface]) return { decision: "fresh", ageMinutes };
  }

  // A run already holds the lease — ten simultaneous page views must produce
  // one sync, not ten. Checking here means the nine others do not even write a
  // skipped `sync_runs` row; the atomic claim inside syncTodayFixtures is what
  // actually guarantees it.
  const { data: heldLock } = await supabase
    .from("sync_locks")
    .select("provider")
    .eq("provider", providerName)
    .eq("entity_type", "fixture")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (heldLock) return { decision: "already_running" };

  // The provider's own last reported remaining count, not an estimate and not a
  // fresh call to ask. Unknown (null) is never treated as low — that would be
  // guessing, not protecting.
  const { data: latestQuotaRun } = await supabase
    .from("sync_runs")
    .select("provider_quota_remaining")
    .not("provider_quota_remaining", "is", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const quotaRemaining = latestQuotaRun?.provider_quota_remaining ?? null;
  if (quotaRemaining !== null && quotaRemaining <= QUOTA_SAFETY_FLOOR) {
    return { decision: "quota_floor", quotaRemaining };
  }

  const result = await (deps?.syncFixtures ?? (() => syncTodayFixtures("auto")))();
  return { decision: "synced", recordsProcessed: result.recordsProcessed };
}

export const AUTO_SYNC_STALENESS_MINUTES = STALENESS_MINUTES;
export const AUTO_SYNC_COOLDOWN_MINUTES = ATTEMPT_COOLDOWN_MINUTES;
