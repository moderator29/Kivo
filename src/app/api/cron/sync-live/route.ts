import "server-only";
import { handleScheduledSync } from "@/lib/football/scheduled-sync";

/**
 * The once-a-minute live worker's entry point.
 *
 * Called by Supabase pg_cron (migration 0067) once the founder arms it, and by
 * Vercel Cron if KIVO ever moves to a plan that permits a sub-daily schedule.
 * The Hobby plan does not, which is why the once-a-day baseline lives at
 * `/api/cron/sync-daily` instead — see that route, and `DECISIONS.md`.
 *
 * All of the real logic (six gates, the sync lease, the quota floor, the
 * rate-limit janitor) lives in `src/lib/football/scheduled-sync.ts` rather than
 * in this file, because two routes share it and a Next.js route module may only
 * export HTTP method handlers and route config — not a function for another
 * route to import.
 */
export async function GET(request: Request) {
  return handleScheduledSync(request, "live");
}
