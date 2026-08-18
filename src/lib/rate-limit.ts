import "server-only";
import { headers } from "next/headers";
import { createServiceRoleSupabaseClient } from "./supabase/server";
import { logError } from "./log";

export type RateLimitResult = { ok: true } | { ok: false; error: string };

/**
 * KIVO_NEXT_GEN KN-93. This used to be a 1-in-200 chance of an **unbounded**
 * `delete ... where created_at < X` — a full sweep of a table whose size grows
 * with total platform activity, run inside `checkRateLimit`, which sits on the
 * first line of essentially every write in the product. It was a sound design
 * when it was written: there was no scheduler, so the sliding window
 * opportunistically kept its own table from growing forever.
 *
 * There is a scheduler now (see `pruneRateLimitEvents` and its caller in
 * src/app/api/cron/sync-live/route.ts), so the sweep belongs there and this is
 * only a backstop for a deployment where the scheduled caller is not wired up.
 * Two changes make it safe to keep in a latency path at all: it is an order of
 * magnitude rarer, and — the part that actually matters — it is now *bounded*,
 * because it goes through `prune_rate_limit_events(seconds, max_rows)`
 * (migration 0061), which deletes at most a fixed number of rows per call. No
 * single user request can pay an unbounded cost for everybody else's history.
 */
const CLEANUP_PROBABILITY = 1 / 2000;
const CLEANUP_MAX_AGE_SECONDS = 60 * 60 * 24; // 1 day — comfortably past any window this app uses
/** Deliberately small: this is the in-request backstop, not the real sweep. */
const CLEANUP_BACKSTOP_MAX_ROWS = 200;

/**
 * Sliding-window rate limiter backed by rate_limit_events (see
 * supabase/migrations/0013_rate_limiting.sql). Counts how many events the
 * given key/action pair has logged in the last `windowSeconds`, and refuses
 * once `maxRequests` is reached.
 *
 * Uses the service-role client deliberately: rate_limit_events has no
 * client-facing RLS policy (nothing for anon/authenticated to read or write),
 * and this needs to work for signed-out guests keyed by IP — not just
 * signed-in profiles RLS can key on via auth.jwt()->>'sub' — so it can't run
 * through the RLS-gated server client at all.
 *
 * Fails open on infra errors (a Supabase hiccup shouldn't lock users out of
 * the app) but fails closed on the actual over-limit case. "Infra error"
 * includes the client *construction*, not just the query:
 * `createServiceRoleSupabaseClient()` throws synchronously ("supabaseKey is
 * required.") when SUPABASE_SERVICE_ROLE_KEY is missing, and that throw
 * happens before any query exists to return an error. checkRateLimit sits on
 * the first line of real work in essentially every write in the product
 * (createPost, createComment, setReaction, voteOnPoll, toggleSave,
 * toggleFollow, submitPrediction, submitFanRating, searchPlatform,
 * setGameweekRoster, joinFantasyLeague), so an unguarded construction turned
 * a missing env var into an unhandled Server Action error on every one of
 * them — the exact opposite of the documented degradation.
 */
export async function checkRateLimit(
  key: string,
  action: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  let supabase: ReturnType<typeof createServiceRoleSupabaseClient>;
  try {
    supabase = createServiceRoleSupabaseClient();
  } catch (error) {
    logError("rateLimit.clientUnavailable", error, { action });
    return { ok: true };
  }

  const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();

  let count: number | null = null;
  try {
    const { count: windowCount, error: countError } = await supabase
      .from("rate_limit_events")
      .select("id", { count: "exact", head: true })
      .eq("profile_id_or_ip", key)
      .eq("action", action)
      .gte("created_at", windowStart);

    if (countError) {
      logError("rateLimit.countFailed", countError, { action });
      return { ok: true };
    }
    count = windowCount;
  } catch (error) {
    // A rejected fetch (DNS, TLS, timeout) never reaches `countError` —
    // supabase-js only surfaces PostgREST-level failures there.
    logError("rateLimit.countThrew", error, { action });
    return { ok: true };
  }

  if ((count ?? 0) >= maxRequests) {
    return {
      ok: false,
      error: "You're doing that a bit too fast. Please wait a moment and try again.",
    };
  }

  // Past this point the caller is already allowed through, so nothing below
  // may change that answer — recording the event and sweeping stale rows are
  // both best-effort bookkeeping.
  try {
    const { error: insertError } = await supabase
      .from("rate_limit_events")
      .insert({ profile_id_or_ip: key, action });
    if (insertError) logError("rateLimit.recordFailed", insertError, { action });

    if (Math.random() < CLEANUP_PROBABILITY) {
      const { error: cleanupError } = await supabase.rpc("prune_rate_limit_events", {
        p_older_than_seconds: CLEANUP_MAX_AGE_SECONDS,
        p_max_rows: CLEANUP_BACKSTOP_MAX_ROWS,
      });
      if (cleanupError) logError("rateLimit.cleanupFailed", cleanupError, { action });
    }
  } catch (error) {
    logError("rateLimit.recordThrew", error, { action });
  }

  return { ok: true };
}

/**
 * Best-effort caller IP for rate-limiting unauthenticated requests (e.g.
 * searchPlatform's guests). Not a real identity/security boundary — it's
 * only used to key a sliding-window counter, so a spoofable header is an
 * acceptable trade-off here (worst case, a spoofed value just gets its own
 * counter bucket).
 */
export async function getClientIp(): Promise<string> {
  const headerList = await headers();
  const forwardedFor = headerList.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  return headerList.get("x-real-ip") ?? "unknown";
}

/**
 * The real sweep (KN-93): called from the scheduled job, not from a user
 * request. Deletes expired `rate_limit_events` rows and returns how many went.
 *
 * Bounded per call by `prune_rate_limit_events`' own row cap (migration 0061)
 * rather than by anything here, so this can never become a long-running delete
 * regardless of who calls it or how far behind the table has fallen. A backlog
 * simply takes several scheduled runs to clear, which is the correct trade for
 * a table nothing reads outside its own sliding window.
 *
 * Best-effort: returns 0 on any failure. Housekeeping must never be the reason
 * a scheduled worker reports itself broken.
 */
export async function pruneRateLimitEvents(maxRows = 5000): Promise<number> {
  try {
    const supabase = createServiceRoleSupabaseClient();
    const { data, error } = await supabase.rpc("prune_rate_limit_events", {
      p_older_than_seconds: CLEANUP_MAX_AGE_SECONDS,
      p_max_rows: maxRows,
    });
    if (error) {
      logError("rateLimit.scheduledPruneFailed", error, {});
      return 0;
    }
    return data ?? 0;
  } catch (error) {
    logError("rateLimit.scheduledPruneFailed", error, {});
    return 0;
  }
}
