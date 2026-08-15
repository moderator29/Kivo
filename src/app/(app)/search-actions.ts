"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { escapeLikePattern } from "@/lib/text";

export type SearchResult = {
  type: "team" | "player" | "competition";
  id: string;
  label: string;
  sublabel: string | null;
  imageUrl: string | null;
};

const RESULTS_PER_CATEGORY = 5;
const MAX_QUERY_LENGTH = 80;

/**
 * Powers the global command palette (⌘K). Searches the three entity tables
 * that already have real synced data and their own detail pages — fixtures
 * aren't included since "search for a match" is better served by browsing
 * /matches, and a name-based fixture search would mostly just re-surface
 * team results anyway.
 *
 * Guest-callable (no auth required), so it's rate-limited by profile when
 * signed in and by IP otherwise — same reasoning as getClientIp's own
 * doc-comment about why a spoofable header is an acceptable key here.
 */
export async function searchPlatform(query: string): Promise<SearchResult[]> {
  const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH);
  if (trimmed.length < 2) return [];

  const profile = await getOrCreateProfile();
  const rateLimitKey = profile ? `user:${profile.id}` : `ip:${await getClientIp()}`;
  const rateLimit = await checkRateLimit(rateLimitKey, "search_platform", 30, 60);
  if (!rateLimit.ok) return [];

  const supabase = createServerSupabaseClient();
  const pattern = `%${escapeLikePattern(trimmed)}%`;

  const playerColumns = "id, full_name, known_as, position, current_team:teams(name)";
  const [{ data: teams }, { data: playersByFullName }, { data: playersByKnownAs }, { data: competitions }] =
    await Promise.all([
      supabase.from("teams").select("id, name, country, crest_url").ilike("name", pattern).limit(RESULTS_PER_CATEGORY),
      // Two plain single-column ilike() calls instead of one .or("full_name.ilike.X,known_as.ilike.X") —
      // .or() takes a raw PostgREST filter string built by string interpolation, and escapeLikePattern
      // above only escapes LIKE's own metacharacters (%, _, \), not PostgREST filter-syntax ones (`,`,
      // `(`, `)`). A search term containing those could inject an unintended extra filter clause. Plain
      // .ilike() calls pass the value as a parameter, not raw filter syntax, so there's nothing to inject.
      supabase.from("players").select(playerColumns).ilike("full_name", pattern).limit(RESULTS_PER_CATEGORY),
      supabase.from("players").select(playerColumns).ilike("known_as", pattern).limit(RESULTS_PER_CATEGORY),
      supabase
        .from("competitions")
        .select("id, name, country, logo_url")
        .ilike("name", pattern)
        .limit(RESULTS_PER_CATEGORY),
    ]);

  const playerById = new Map((playersByFullName ?? []).concat(playersByKnownAs ?? []).map((p) => [p.id, p]));
  const players = [...playerById.values()].slice(0, RESULTS_PER_CATEGORY);

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
