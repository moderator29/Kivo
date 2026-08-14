"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export type SearchResult = {
  type: "team" | "player" | "competition";
  id: string;
  label: string;
  sublabel: string | null;
  imageUrl: string | null;
};

const RESULTS_PER_CATEGORY = 5;

/**
 * Powers the global command palette (⌘K). Searches the three entity tables
 * that already have real synced data and their own detail pages — fixtures
 * aren't included since "search for a match" is better served by browsing
 * /matches, and a name-based fixture search would mostly just re-surface
 * team results anyway.
 */
export async function searchPlatform(query: string): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const supabase = createServerSupabaseClient();
  const pattern = `%${trimmed}%`;

  const [{ data: teams }, { data: players }, { data: competitions }] = await Promise.all([
    supabase.from("teams").select("id, name, country, crest_url").ilike("name", pattern).limit(RESULTS_PER_CATEGORY),
    supabase
      .from("players")
      .select("id, full_name, known_as, position, current_team:teams(name)")
      .or(`full_name.ilike.${pattern},known_as.ilike.${pattern}`)
      .limit(RESULTS_PER_CATEGORY),
    supabase
      .from("competitions")
      .select("id, name, country, logo_url")
      .ilike("name", pattern)
      .limit(RESULTS_PER_CATEGORY),
  ]);

  const results: SearchResult[] = [];

  for (const team of teams ?? []) {
    results.push({ type: "team", id: team.id, label: team.name, sublabel: team.country, imageUrl: team.crest_url });
  }
  for (const player of players ?? []) {
    results.push({
      type: "player",
      id: player.id,
      label: player.known_as ?? player.full_name,
      sublabel: [player.position, player.current_team?.name].filter(Boolean).join(" · ") || null,
      imageUrl: null,
    });
  }
  for (const competition of competitions ?? []) {
    results.push({
      type: "competition",
      id: competition.id,
      label: competition.name,
      sublabel: competition.country,
      imageUrl: competition.logo_url,
    });
  }

  return results;
}
