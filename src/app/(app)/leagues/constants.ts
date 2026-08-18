/** `/leagues` had no `.limit()` at all before this — every synced
 * competition rendered into one DOM node (RECOMMENDATIONS item 112). 60 per
 * page, offset-based "Load more" rather than true infinite scroll, to keep
 * this simple.
 *
 * Kept in its own module (not `actions.ts`) since a `"use server"` file may
 * only export async functions — a plain constant export there is a build
 * error. */
export const LEAGUES_PAGE_SIZE = 60;

export type LeagueListItem = {
  id: string;
  name: string;
  country: string | null;
  logoUrl: string | null;
  currentSeasonName: string | null;
  hasSeason: boolean;
};

/** The `competitions` columns every list surface selects, and the shape they
 * map to. Lived in `actions.ts` until KN-47 moved pagination into the URL and
 * left that server action with no caller. */
export const LEAGUE_LIST_SELECT = "id, name, country, logo_url, seasons(id, name, is_current)";

export function mapCompetitionRow(row: {
  id: string;
  name: string;
  country: string | null;
  logo_url: string | null;
  seasons: { id: string; name: string; is_current: boolean }[] | null;
}): LeagueListItem {
  // A competition can carry several seasons; "current" is the one to name, and
  // the newest known one is the honest fallback when none is flagged.
  const currentSeason = row.seasons?.find((s) => s.is_current) ?? row.seasons?.[0] ?? null;
  return {
    id: row.id,
    name: row.name,
    country: row.country,
    logoUrl: row.logo_url,
    currentSeasonName: currentSeason?.name ?? null,
    hasSeason: currentSeason !== null,
  };
}
