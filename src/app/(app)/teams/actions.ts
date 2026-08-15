"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { TEAMS_PAGE_SIZE } from "./constants";

export type TeamListItem = {
  id: string;
  name: string;
  shortName: string | null;
  country: string | null;
  crestUrl: string | null;
};

function mapTeam(row: { id: string; name: string; short_name: string | null; country: string | null; crest_url: string | null }): TeamListItem {
  return { id: row.id, name: row.name, shortName: row.short_name, country: row.country, crestUrl: row.crest_url };
}

/** Fetches one page of teams starting at `offset`. Requests `PAGE_SIZE + 1`
 * rows (via `.range`) so `hasMore` can be read directly off the response
 * instead of a second `count`-only query. */
export async function loadMoreTeams(offset: number): Promise<{ error: string | null; teams: TeamListItem[]; hasMore: boolean }> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("teams")
    .select("id, name, short_name, country, crest_url")
    .order("name", { ascending: true })
    .range(offset, offset + TEAMS_PAGE_SIZE);

  if (error) {
    console.error("Failed to load more teams", error);
    return { error: "Couldn't load more teams. Try again.", teams: [], hasMore: false };
  }

  const rows = data ?? [];
  return {
    error: null,
    teams: rows.slice(0, TEAMS_PAGE_SIZE).map(mapTeam),
    hasMore: rows.length > TEAMS_PAGE_SIZE,
  };
}
