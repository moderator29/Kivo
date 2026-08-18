/**
 * Shared shapes for the "change the club you support" picker
 * (src/app/(app)/profile/club/page.tsx and its client half).
 *
 * They live here rather than beside the server action that produces them
 * because `src/app/(app)/profile/actions.ts` carries the "use server"
 * directive, and such a module may only export async functions — a plain
 * exported constant there is a build error, not a style preference.
 */

/** One screenful of clubs. The picker is a search box, not a directory — a
 * longer page of results is not more useful than typing two more letters. */
export const TEAM_PICKER_LIMIT = 40;

export type PickerTeam = {
  id: string;
  name: string;
  short_name: string | null;
  crest_url: string | null;
  country: string | null;
};
