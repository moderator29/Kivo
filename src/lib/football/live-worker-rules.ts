import type { Database } from "@/lib/supabase/types";

/**
 * Pure decision logic for the automated live-sync cron worker
 * (src/app/api/cron/sync-live/route.ts). Deliberately NOT `server-only` —
 * same rationale as api-football-request.ts's own module doc comment: this
 * needs to stay importable from unit tests without dragging in the route's
 * Next.js/Supabase/env dependencies.
 */

type FixtureStatus = Database["public"]["Enums"]["fixture_status"];

export interface FixtureRelevanceWindow {
  /** A 'scheduled' fixture kicking off within this many minutes counts as imminent. */
  imminentWindowMinutes: number;
  /** A 'scheduled' fixture whose kickoff is further in the past than this is
   * treated as stale (a provider data gap this worker can't fix by asking
   * again), not imminent — see the route's own doc comment on
   * STALE_SCHEDULED_CEILING_HOURS for why this ceiling exists at all. */
  staleScheduledCeilingHours: number;
  /** Injectable for tests — defaults to the real current time. */
  now?: Date;
}

/**
 * True when a fixture is worth spending a real provider call on right now.
 * `live`/`halftime` always qualify (something is actually happening).
 * `scheduled` qualifies only inside the imminent window and not past the
 * stale ceiling. Every other status (`finished`, `postponed`, `cancelled`,
 * `abandoned`, `unknown`) never qualifies — a worker whose whole job is
 * "don't waste quota" has no business re-syncing a fixture that's already
 * over or was never going to happen.
 *
 * This is the single source of truth for that judgment — the cron route's
 * Supabase query filters coarsely at the database level (any live/halftime
 * row, or any scheduled row with kickoff_at at or before the imminent
 * window's upper bound — no lower bound applied in SQL) and then calls this
 * function per candidate row to make the real, precise decision, including
 * the stale-ceiling lower bound. That split keeps the query itself simple
 * (existing indexes on fixtures(status)/fixtures(kickoff_at) already cover
 * it — see migrations 0001/0021) while keeping exactly one tested place that
 * decides what "relevant" means.
 */
export function isFixtureWorthSyncing(
  status: FixtureStatus,
  kickoffAt: string,
  window: FixtureRelevanceWindow,
): boolean {
  if (status === "live" || status === "halftime") return true;
  if (status !== "scheduled") return false;

  const now = window.now ?? new Date();
  const kickoffMs = new Date(kickoffAt).getTime();
  const imminentByMs = now.getTime() + window.imminentWindowMinutes * 60_000;
  const staleFloorMs = now.getTime() - window.staleScheduledCeilingHours * 60 * 60_000;

  return kickoffMs <= imminentByMs && kickoffMs >= staleFloorMs;
}

/**
 * Vercel's documented convention (https://vercel.com/docs/cron-jobs/manage-cron-jobs,
 * "Securing cron jobs"): Vercel populates `CRON_SECRET` and sends it back as
 * a Bearer token on every request it makes to a scheduled path. A missing
 * `cronSecret` (not yet configured) always fails closed — never treated as
 * "no secret required."
 */
export function isAuthorizedCronRequest(authorizationHeader: string | null, cronSecret: string | undefined | null): boolean {
  if (!cronSecret) return false;
  return authorizationHeader === `Bearer ${cronSecret}`;
}
