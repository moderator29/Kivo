"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { escapeLikePattern } from "@/lib/text";
import type { SearchCoverage } from "@/lib/search-coverage";

export type SearchResultType = "team" | "player" | "competition" | "manager" | "venue";

export type SearchResult = {
  type: SearchResultType;
  id: string;
  label: string;
  sublabel: string | null;
  imageUrl: string | null;
};

const RESULTS_PER_CATEGORY = 5;
const MAX_QUERY_LENGTH = 80;

export type PopularTeam = {
  id: string;
  name: string;
  crestUrl: string | null;
  followerCount: number;
};

const POPULAR_TEAMS_LIMIT = 6;

/**
 * RECOMMENDATIONS.md item 128's "trending" half of the command palette's
 * zero state — real usage data, not a fabricated list. This codebase has no
 * view-tracking of any kind (no page-view table, no analytics event log), so
 * a genuine "most viewed" ranking isn't buildable honestly; `follows` is,
 * and is deliberately surfaced as "Popular" rather than "Trending" in the UI
 * (see command-palette.tsx) — a real follower count is a legitimate
 * popularity signal, but it isn't the time-windowed live-activity thing
 * "trending" usually implies, and this codebase doesn't have that data.
 *
 * follows_select_own (migration 0001) blocks a plain cross-user count from
 * the client, so this goes through get_most_followed_teams — a narrow
 * SECURITY DEFINER aggregate (migration 0040) that returns only counts,
 * never who follows whom, same pattern as get_prediction_consensus.
 * Returns an empty array (never fabricated placeholder teams) once nobody
 * has followed a team yet.
 */
export async function getPopularTeams(): Promise<PopularTeam[]> {
  const supabase = createServerSupabaseClient();

  const { data: popular, error } = await supabase.rpc("get_most_followed_teams", { p_limit: POPULAR_TEAMS_LIMIT });
  if (error || !popular || popular.length === 0) return [];

  const teamIds = popular.map((row) => row.team_id);
  const { data: teams } = await supabase.from("teams").select("id, name, crest_url").in("id", teamIds);
  const teamById = new Map((teams ?? []).map((t) => [t.id, t]));

  return popular
    .map((row): PopularTeam | null => {
      const team = teamById.get(row.team_id);
      if (!team) return null;
      return { id: team.id, name: team.name, crestUrl: team.crest_url, followerCount: Number(row.follower_count) };
    })
    .filter((t): t is PopularTeam => t !== null);
}

/**
 * Powers the global command palette (⌘K) and the /search page. Searches the
 * five entity tables that already have real synced data and their own detail
 * pages — fixtures aren't included since "search for a match" is better served
 * by browsing /matches, and a name-based fixture search would mostly just
 * re-surface team results anyway.
 *
 * KIVO_NEXT_GEN KN-58: managers and venues were added because /managers and
 * /venues are otherwise unreachable from anywhere in the app shell (KN-30) —
 * two more ilike queries against tables that already carry the pg_trgm indexes
 * migration 0021 created. `venues.name` is nullable (see migration 0020), so a
 * nameless venue row simply never matches a name search rather than rendering
 * as an untitled result.
 *
 * Guest-callable (no auth required), so it's rate-limited by profile when
 * signed in and by IP otherwise — same reasoning as getClientIp's own
 * doc-comment about why a spoofable header is an acceptable key here.
 */
export async function searchPlatform(query: string): Promise<{ error: string | null; results: SearchResult[] }> {
  const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH);
  if (trimmed.length < 2) return { error: null, results: [] };

  const profile = await getOrCreateProfile();
  const rateLimitKey = profile ? `user:${profile.id}` : `ip:${await getClientIp()}`;
  const rateLimit = await checkRateLimit(rateLimitKey, "search_platform", 30, 60);
  // Bug 6 (audit): used to silently `return []` here, indistinguishable from
  // a genuine zero-result search — same { error, ... } shape searchPlayers
  // (players/actions.ts) already uses for the same situation, so the caller
  // can show real rate-limit copy instead of a misleading "No matches".
  if (!rateLimit.ok) return { error: rateLimit.error, results: [] };

  const supabase = createServerSupabaseClient();
  const pattern = `%${escapeLikePattern(trimmed)}%`;

  const playerColumns = "id, full_name, known_as, position, current_team:teams(name)";
  const [
    { data: teams },
    { data: playersByFullName },
    { data: playersByKnownAs },
    { data: competitions },
    { data: managers },
    { data: venues },
  ] = await Promise.all([
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
      supabase
        .from("managers")
        .select("id, full_name, nationality, current_team:teams(name)")
        .ilike("full_name", pattern)
        .limit(RESULTS_PER_CATEGORY),
      supabase
        .from("venues")
        .select("id, name, city, country")
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
  for (const manager of managers ?? []) {
    results.push({
      type: "manager",
      id: manager.id,
      label: manager.full_name,
      sublabel: [manager.current_team?.name, manager.nationality].filter(Boolean).join(" · ") || null,
      imageUrl: null,
    });
  }
  for (const venue of venues ?? []) {
    // venues.name is nullable in the schema; a row without one has nothing to
    // show and could not have matched the name filter anyway.
    if (!venue.name) continue;
    results.push({
      type: "venue",
      id: venue.id,
      label: venue.name,
      sublabel: [venue.city, venue.country].filter(Boolean).join(", ") || null,
      imageUrl: null,
    });
  }

  return { error: null, results };
}

/**
 * What the search index actually contains right now, as five real counts.
 *
 * Powers the empty state: "no matches" means something completely different
 * against a full division than it does against an index of two clubs, and
 * only the caller of this can tell the difference. Head-only counts, so this
 * costs five index scans and returns no rows.
 *
 * A failed count is reported as 0 rather than thrown — the worst outcome is
 * an empty-state sentence that understates coverage, and that is much better
 * than a search page that errors because a count did.
 */
export async function getSearchCoverage(): Promise<SearchCoverage> {
  const supabase = createServerSupabaseClient();

  const [teams, players, competitions, managers, venues] = await Promise.all([
    supabase.from("teams").select("id", { count: "exact", head: true }),
    supabase.from("players").select("id", { count: "exact", head: true }),
    supabase.from("competitions").select("id", { count: "exact", head: true }),
    supabase.from("managers").select("id", { count: "exact", head: true }),
    supabase.from("venues").select("id", { count: "exact", head: true }),
  ]);

  return {
    teams: teams.count ?? 0,
    players: players.count ?? 0,
    competitions: competitions.count ?? 0,
    managers: managers.count ?? 0,
    venues: venues.count ?? 0,
  };
}
