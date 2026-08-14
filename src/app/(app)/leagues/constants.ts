/** `/leagues` had no `.limit()` at all before this — every synced
 * competition rendered into one DOM node (RECOMMENDATIONS item 112). 60 per
 * page, offset-based "Load more" rather than true infinite scroll, to keep
 * this simple.
 *
 * Kept in its own module (not `actions.ts`) since a `"use server"` file may
 * only export async functions — a plain constant export there is a build
 * error. */
export const LEAGUES_PAGE_SIZE = 60;
