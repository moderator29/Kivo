/** Page size for `/fantasy/browse`'s public-league listing, same offset-based
 * "Load more" shape as `/leagues` (see that route's own constants.ts for why
 * this lives in its own module rather than `actions.ts` -- a `"use server"`
 * file may only export async functions, so a plain constant export there is
 * a build error). */
export const PUBLIC_FANTASY_LEAGUES_PAGE_SIZE = 20;
