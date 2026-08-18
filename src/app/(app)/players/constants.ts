/** Shared between the initial server-rendered `/players` fetch (page.tsx)
 * and the debounced `searchPlayers` server action, so a page-load result and
 * a searched result can never disagree about what "showing every match"
 * means, and both drive the same truncation notice.
 *
 * Kept in its own module (not `actions.ts`) since a `"use server"` file may
 * only export async functions — a plain constant export there is a build
 * error (same reasoning as `leagues/constants.ts`). */
export const RESULTS_LIMIT = 100;
