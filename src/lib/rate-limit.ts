import "server-only";
import { headers } from "next/headers";
import { createServiceRoleSupabaseClient } from "./supabase/server";

export type RateLimitResult = { ok: true } | { ok: false; error: string };

// Chance (1 in N) of also sweeping rows older than CLEANUP_MAX_AGE_SECONDS on
// any given check. This is the only cleanup this table gets — there's no
// pg_cron/scheduled-job budget for a dedicated janitor, so the sliding window
// itself opportunistically keeps the table from growing forever instead.
const CLEANUP_PROBABILITY = 1 / 200;
const CLEANUP_MAX_AGE_SECONDS = 60 * 60 * 24; // 1 day — comfortably past any window this app uses

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
 * the app) but fails closed on the actual over-limit case.
 */
export async function checkRateLimit(
  key: string,
  action: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const supabase = createServiceRoleSupabaseClient();
  const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();

  const { count, error: countError } = await supabase
    .from("rate_limit_events")
    .select("id", { count: "exact", head: true })
    .eq("profile_id_or_ip", key)
    .eq("action", action)
    .gte("created_at", windowStart);

  if (countError) {
    console.error("Rate limit check failed, allowing the request through", countError);
    return { ok: true };
  }

  if ((count ?? 0) >= maxRequests) {
    return {
      ok: false,
      error: "You're doing that a bit too fast. Please wait a moment and try again.",
    };
  }

  const { error: insertError } = await supabase
    .from("rate_limit_events")
    .insert({ profile_id_or_ip: key, action });
  if (insertError) console.error("Failed to record rate limit event", insertError);

  if (Math.random() < CLEANUP_PROBABILITY) {
    const staleBefore = new Date(Date.now() - CLEANUP_MAX_AGE_SECONDS * 1000).toISOString();
    const { error: cleanupError } = await supabase.from("rate_limit_events").delete().lt("created_at", staleBefore);
    if (cleanupError) console.error("Rate limit table cleanup failed", cleanupError);
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
