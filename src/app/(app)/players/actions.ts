"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { positionGroup, type PositionGroup } from "@/app/(app)/fantasy/fantasy-rules";
import { escapeLikePattern } from "@/lib/text";

export type PlayerSearchResult = {
  id: string;
  name: string;
  position: string | null;
  nationality: string | null;
  teamName: string | null;
  photoUrl: string | null;
};

const RESULTS_LIMIT = 100;

// Mirrors searchFantasyPlayers' DB-level position OR-filter in
// src/app/(app)/fantasy/actions.ts exactly (same free-text `position` column,
// same providers) — kept in sync by hand since that file isn't imported here,
// but both ultimately narrow to the same positionGroup() classifier below, so
// the two can never disagree on what counts as, say, a Defender.
const POSITION_ILIKE_FILTERS: Record<PositionGroup, string> = {
  Goalkeepers: "position.ilike.%keeper%,position.ilike.gk",
  Defenders: "position.ilike.%back%,position.ilike.%defen%,position.ilike.df",
  Midfielders: "position.ilike.%mid%,position.ilike.mf",
  Forwards:
    "position.ilike.%forward%,position.ilike.%striker%,position.ilike.%wing%,position.ilike.fw,position.ilike.st",
};

/**
 * Search/filter action backing `/players` — a server action called on demand
 * from a debounced client input, not a bulk page-load fetch, since the
 * synced player table can grow well past what's reasonable to render at
 * once (RECOMMENDATIONS item 111: the page used to hard-stop at the first
 * 100 alphabetical players with no way to reach anyone past that).
 *
 * All filters (name search, position, club) are applied server-side, before
 * `.limit()` — the exact bug already found and fixed once in
 * searchFantasyPlayers (filtering in JS after the limit only ever searches
 * whichever rows happened to land in the first page).
 */
export async function searchPlayers(
  query: string,
  position: PositionGroup | "All",
  teamId: string | "All",
): Promise<{ error: string | null; players: PlayerSearchResult[] }> {
  const supabase = createServerSupabaseClient();

  let request = supabase
    .from("players")
    .select("id, full_name, known_as, position, nationality, photo_url, current_team_id, team:teams(name, short_name)")
    .order("full_name", { ascending: true });

  const trimmed = query.trim();
  if (trimmed) request = request.ilike("full_name", `%${escapeLikePattern(trimmed)}%`);
  if (teamId !== "All") request = request.eq("current_team_id", teamId);
  if (position !== "All") request = request.or(POSITION_ILIKE_FILTERS[position]);

  const { data: players, error } = await request.limit(RESULTS_LIMIT);
  if (error) {
    console.error("Failed to search players", error);
    return { error: "Couldn't load players. Try again.", players: [] };
  }

  // The ilike OR above is a coarse push-down (keeps the position filter in
  // the DB query, before the limit); re-run the exact classifier here to
  // drop any false positives it let through, same two-step as fantasy's.
  const filtered = (players ?? []).filter((p) => position === "All" || positionGroup(p.position) === position);

  return {
    error: null,
    players: filtered.map((p) => ({
      id: p.id,
      name: p.known_as ?? p.full_name,
      position: p.position,
      nationality: p.nationality,
      teamName: p.team?.short_name ?? p.team?.name ?? null,
      photoUrl: p.photo_url,
    })),
  };
}
