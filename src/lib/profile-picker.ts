/**
 * Shared shapes for the "club you support" picker
 * (src/app/(app)/profile/club/page.tsx, its client half, and onboarding's own
 * club step).
 *
 * They live here rather than beside the server action that produces them
 * because `src/app/(app)/profile/actions.ts` carries the "use server"
 * directive, and such a module may only export async functions — a plain
 * exported constant there is a build error, not a style preference.
 */

/**
 * One screenful of clubs.
 *
 * The picker is a search box over a table that grows without bound, not a
 * directory: 705 clubs on the live database today, and the club catalogue
 * (migration 0107) is built to pull every club in every configured
 * competition, so this number must never be "however many there are". Forty
 * is what fills a phone screen several times over without a scroll that never
 * ends; `search_clubs_ranked` caps itself at 100 regardless of what is asked
 * for, so this is a page size rather than a trust boundary.
 */
export const TEAM_PICKER_LIMIT = 40;

export type PickerTeam = {
  id: string;
  name: string;
  short_name: string | null;
  crest_url: string | null;
  country: string | null;
  /**
   * How many KIVO profiles follow this club. A real count from `follows`, via
   * `search_clubs_ranked` (migration 0108) — the one ordering signal the
   * picker has, and the only one it is allowed to have, because KIVO holds no
   * popularity data and inventing a "major clubs" list would be an opinion
   * presented as a measurement.
   *
   * Zero for every club until real people start following clubs, at which
   * point the ordering starts meaning something on its own. Shown on a row
   * only when it is above zero: "0 followers" is noise on every row of a young
   * product.
   */
  follower_count: number;
};

/** One narrowing option offered by the picker, with a real count behind it. */
export type PickerFacet = {
  key: string;
  label: string;
  clubCount: number;
};

/**
 * What the picker can narrow by, as `club_picker_facets` reports it.
 *
 * Either list can legitimately be empty and an empty list means the control is
 * not rendered at all. That is load-bearing rather than defensive:
 * `teams.country` is null on every row the live provider has synced, so a
 * country filter today would be a control that can only ever produce an empty
 * list — and an empty control is a promise the data cannot keep.
 */
export type PickerFacets = {
  competitions: PickerFacet[];
  countries: PickerFacet[];
};

export const EMPTY_PICKER_FACETS: PickerFacets = { competitions: [], countries: [] };
