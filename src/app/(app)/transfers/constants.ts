/** `/transfers` used to hard-cap at 50 rows with no way to reach anything
 * older, with or without filters active, and nothing on screen indicated
 * the list was partial (audit item 2). Same offset + "Load more" pattern
 * as `TEAMS_PAGE_SIZE`/`LEAGUES_PAGE_SIZE`.
 *
 * Kept in its own module (not `actions.ts`) since a `"use server"` file may
 * only export async functions — a plain constant export there is a build
 * error (same reasoning as `leagues/constants.ts`). */
export const TRANSFERS_PAGE_SIZE = 50;
