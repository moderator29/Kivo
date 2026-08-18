import "server-only";
import { handleScheduledSync } from "@/lib/football/scheduled-sync";

/**
 * The once-a-day baseline sync (founder instruction, 2026-08-18: "Make it
 * automatic — no need for triggering now").
 *
 * This is the schedule Vercel's Hobby plan actually accepts. A sub-daily
 * expression is rejected at deploy time with "Hobby accounts are limited to
 * daily cron jobs", which is what removed the `crons` array in the first place
 * and blocked every deployment while it was there. `vercel.json` points at this
 * path with `0 5 * * *` — once a day, unambiguously legal, no plan change.
 *
 * A separate route rather than a `?mode=daily` query string on the live worker:
 * Vercel's cron documentation only ever shows a bare path, a query string there
 * is undocumented, and a `vercel.json` that fails validation blocks every
 * deployment. This shape cannot fail that way.
 *
 * What it does and does not do is the important part, and it is stated the same
 * way in `docs/LIVE_DATA.md` so nobody reads "automatic sync" and hears "live
 * scores":
 *
 *   Does — pull today's fixtures once a day, which is what creates the
 *   competitions, clubs, venues and fixtures every other surface reads. On an
 *   empty database this is what makes it stop being empty.
 *
 *   Does not — keep a scoreline current. One call a day cannot, and nothing
 *   here pretends otherwise. Minute-by-minute freshness needs either the
 *   pg_cron path armed (migration 0067) or a Vercel plan that permits a
 *   sub-daily schedule; in between, `src/lib/football/auto-sync.ts` refreshes
 *   on page views, which is neither of those things and says so.
 *
 * Unlike the live worker this deliberately does not consult
 * `FOOTBALL_LIVE_POLLING_ENABLED`. That flag exists to stop a once-a-minute
 * worker draining a 100-request-a-day free tier; one request a day cannot drain
 * anything, and gating the baseline on it would mean a database that can never
 * fill itself. The flag is only ever read, never written — flipping it from
 * code is forbidden. Everything that protects the account still applies:
 * `CRON_SECRET`, a real provider being configured, the sync lease, and the
 * quota floor.
 */
export async function GET(request: Request) {
  return handleScheduledSync(request, "daily");
}
