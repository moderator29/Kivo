"use server";

import { logError } from "@/lib/log";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { LEAGUES_PAGE_SIZE } from "./constants";

export type LeagueListItem = {
  id: string;
  name: string;
  country: string | null;
  logoUrl: string | null;
  currentSeasonName: string | null;
  hasSeason: boolean;
};

type CompetitionRow = {
  id: string;
  name: string;
  country: string | null;
  logo_url: string | null;
  seasons: { id: string; name: string; is_current: boolean }[] | null;
};

function mapCompetition(row: CompetitionRow): LeagueListItem {
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

/** Fetches one page of competitions starting at `offset`. Requests
 * `PAGE_SIZE + 1` rows (via `.range`) so `hasMore` can be read directly off
 * the response instead of a second `count`-only query. */
export async function loadMoreLeagues(offset: number): Promise<{ error: string | null; leagues: LeagueListItem[]; hasMore: boolean }> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("competitions")
    .select("id, name, country, logo_url, seasons(id, name, is_current)")
    .order("name", { ascending: true })
    .range(offset, offset + LEAGUES_PAGE_SIZE);

  if (error) {
    logError("leagues.loadMore", error);
    return { error: "Couldn't load more leagues. Try again.", leagues: [], hasMore: false };
  }

  const rows = data ?? [];
  return {
    error: null,
    leagues: rows.slice(0, LEAGUES_PAGE_SIZE).map(mapCompetition),
    hasMore: rows.length > LEAGUES_PAGE_SIZE,
  };
}
