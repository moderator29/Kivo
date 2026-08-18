/** `/teams` had no `.limit()` at all before this — every synced club rendered
 * into one DOM node (RECOMMENDATIONS item 112). 60 per page, offset-based
 * "Load more" rather than true infinite scroll, to keep this simple.
 *
 * Kept in its own module (not `actions.ts`) since a `"use server"` file may
 * only export async functions — a plain constant export there is a build
 * error. */
export const TEAMS_PAGE_SIZE = 60;

export type TeamListItem = {
  id: string;
  name: string;
  shortName: string | null;
  country: string | null;
  crestUrl: string | null;
};

/** The `teams` columns every list surface selects, and the shape they map to.
 * Lived in `actions.ts` until KN-47 moved pagination into the URL and left
 * that server action with no caller. */
export const TEAM_LIST_SELECT = "id, name, short_name, country, crest_url";

export function mapTeamRow(row: {
  id: string;
  name: string;
  short_name: string | null;
  country: string | null;
  crest_url: string | null;
}): TeamListItem {
  return { id: row.id, name: row.name, shortName: row.short_name, country: row.country, crestUrl: row.crest_url };
}
