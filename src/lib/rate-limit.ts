import "server-only";
import { headers } from "next/headers";
import { createServiceRoleSupabaseClient } from "./supabase/server";
import { logError } from "./log";
import { formatRetryAfter } from "./rate-limit-format";

export { formatRetryAfter };

export type RateLimitResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      /** Whole seconds until the oldest event in the window falls out of it —
       * i.e. the first moment this action can succeed again. Null only when the
       * lookup that computes it failed, in which case `error` says "in a
       * moment" rather than naming a duration it doesn't know. */
      retryAfterSeconds: number | null;
    };

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
 * once `maxRequests` is reached — atomically, in a single round trip, since
 * migration 0066 (KN-25).
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

  // KN-25. This used to be a count query followed, further down, by a separate
  // insert — two round trips with no transaction between them. Two concurrent
  // requests both read a count under the limit and both proceeded, so the
  // effective ceiling under concurrency was higher than the configured one.
  // Tolerable for post spam; not tolerable for the OTP request/verify endpoints
  // (KN-116), where the entire value of the limit is that it cannot be outrun
  // by parallelism.
  //
  // `consume_rate_limit` (migration 0066) decides and records in one call,
  // serialized per (action, key) by a transaction-scoped advisory lock. Read
  // that migration for why wrapping the two statements in one transaction is
  // necessary but NOT sufficient on its own: the thing that needs locking is an
  // absence of rows, and no row lock can cover that. Different keys never
  // contend, so one abusive address cannot slow anybody else's writes down.
  let allowed: boolean;
  try {
    const { data, error } = await supabase.rpc("consume_rate_limit", {
      p_key: key,
      p_action: action,
      p_max_requests: maxRequests,
      p_window_seconds: windowSeconds,
    });

    if (error) {
      // Unchanged stance: fail OPEN on an infrastructure error (a Supabase
      // hiccup must not lock users out of the whole product), closed only on a
      // real over-limit answer.
      logError("rateLimit.consumeFailed", error, { action });
      return { ok: true };
    }
    allowed = data !== false;
  } catch (error) {
    // A rejected fetch (DNS, TLS, timeout) never reaches `error` — supabase-js
    // only surfaces PostgREST-level failures there.
    logError("rateLimit.consumeThrew", error, { action });
    return { ok: true };
  }

  if (!allowed) {
    // KN-60: every rejection used to read "You're doing that a bit too fast.
    // Please wait a moment and try again." — for a 60-second posting window and
    // for a 24-hour one alike. The window knows exactly when it reopens, and a
    // user who is told "a moment" for something that is actually hours away has
    // been misled by a message that was trying to be gentle.
    //
    // The reopening time is the oldest event still inside the window plus the
    // window length. One extra indexed read, and only on the rejection path —
    // the allowed path (the overwhelming majority) is untouched.
    let retryAfterSeconds: number | null = null;
    try {
      const { data: oldest } = await supabase
        .from("rate_limit_events")
        .select("created_at")
        .eq("profile_id_or_ip", key)
        .eq("action", action)
        .gte("created_at", windowStart)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (oldest) {
        const reopensAt = new Date(oldest.created_at).getTime() + windowSeconds * 1000;
        retryAfterSeconds = Math.max(1, Math.ceil((reopensAt - Date.now()) / 1000));
      }
    } catch (error) {
      // Never let the *explanation* of a refusal turn into a different failure.
      logError("rateLimit.retryAfterFailed", error, { action });
    }

    return {
      ok: false,
      error: retryAfterSeconds
        ? `You're doing that too quickly. Try again in ${formatRetryAfter(retryAfterSeconds)}.`
        : "You're doing that too quickly. Try again in a moment.",
      retryAfterSeconds,
    };
  }

  // The event row was already written by consume_rate_limit, inside the same
  // statement that allowed this caller through. Nothing below may change that
  // answer — the stale-row sweep is best-effort bookkeeping.
  try {
    if (Math.random() < CLEANUP_PROBABILITY) {
      const { error: cleanupError } = await supabase.rpc("prune_rate_limit_events", {
        p_older_than_seconds: CLEANUP_MAX_AGE_SECONDS,
        p_max_rows: CLEANUP_BACKSTOP_MAX_ROWS,
      });
      if (cleanupError) logError("rateLimit.cleanupFailed", cleanupError, { action });
    }
  } catch (error) {
    logError("rateLimit.cleanupThrew", error, { action });
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
