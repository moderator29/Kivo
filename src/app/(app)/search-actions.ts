"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { escapeLikePattern } from "@/lib/text";
import { queryTerms, rankByRelevance } from "@/lib/search-ranking";
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

/**
 * How many rows each category fetches before ranking, as a multiple of what it
 * shows. Ranking can only reorder what it was given, so fetching exactly five
 * and then sorting them is sorting an arbitrary five — "arsenal" would still
 * be able to return three under-21 sides and no Arsenal. Fetching a wider slice
 * and keeping the best five is what makes the ordering mean anything, and it
 * costs the same number of queries.
 */
const FETCH_MULTIPLIER = 4;
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
 * against tables that already carry the pg_trgm indexes migration 0021 created,
 * which is what keeps a `%…%` filter index-served rather than a scan.
 * `venues.name` is nullable (see migration 0020), so a nameless venue row
 * simply never matches a name search rather than rendering as an untitled
 * result.
 *
 * ## Forgiving, and then ordered
 *
 * The query is split into words and each one must appear in the name, in any
 * order — so "man united" finds Manchester United, which the single-substring
 * version this replaced could not, because "man united" is not a substring of
 * anything. What comes back is then ranked by `rankByRelevance`
 * (src/lib/search-ranking.ts) and cut to five per category, so the five a
 * reader sees are the five best matches rather than the five the database
 * happened to return first. Both halves are needed: without the wider fetch
 * the ranking sorts an arbitrary handful, and without the ranking the wider
 * fetch just returns more arbitrary rows.
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

  /**
   * One `ilike` per word, chained — PostgREST ANDs them, so every word has to
   * appear somewhere in the name but they may appear in any order and with
   * anything between. That is what makes "man united" find Manchester United
   * and "inter milan" find Inter, neither of which is a substring of the name
   * a fan is looking for.
   *
   * Still one `.ilike()` per term rather than a built `.or()` string: the
   * value rides as a parameter, so nothing here can be read as filter syntax.
   * `escapeLikePattern` handles LIKE's own metacharacters on top of that.
   */
  const terms = queryTerms(trimmed);
  const patterns = terms.map((term) => `%${escapeLikePattern(term)}%`);
  const fetchLimit = RESULTS_PER_CATEGORY * FETCH_MULTIPLIER;

  function matchAllTerms<T extends { ilike(column: string, pattern: string): T }>(request: T, column: string): T {
    return patterns.reduce((accumulated, pattern) => accumulated.ilike(column, pattern), request);
  }

  const playerColumns = "id, full_name, known_as, position, current_team:teams(name)";
  const [
    { data: teams },
    { data: playersByFullName },
    { data: playersByKnownAs },
    { data: competitions },
    { data: managers },
    { data: venues },
  ] = await Promise.all([
      matchAllTerms(supabase.from("teams").select("id, name, country, crest_url"), "name").limit(fetchLimit),
      // Two plain single-column filters instead of one `.or(...)`: `.or()` takes
      // a raw PostgREST filter string built by interpolation, and
      // escapeLikePattern escapes LIKE's metacharacters (%, _, \) but not
      // PostgREST's own (`,`, `(`, `)`). A term containing those could add a
      // filter clause nobody wrote.
      matchAllTerms(supabase.from("players").select(playerColumns), "full_name").limit(fetchLimit),
      matchAllTerms(supabase.from("players").select(playerColumns), "known_as").limit(fetchLimit),
      matchAllTerms(supabase.from("competitions").select("id, name, country, logo_url"), "name").limit(fetchLimit),
      matchAllTerms(
        supabase.from("managers").select("id, full_name, nationality, current_team:teams(name)"),
        "full_name",
      ).limit(fetchLimit),
      matchAllTerms(supabase.from("venues").select("id, name, city, country"), "name").limit(fetchLimit),
    ]);

  const playerById = new Map((playersByFullName ?? []).concat(playersByKnownAs ?? []).map((p) => [p.id, p]));
  // Ranked against the name a reader will actually see, which for a player is
  // the one they are known by — ranking "Cristiano Ronaldo dos Santos Aveiro"
  // against a search for "ronaldo" and then rendering "Cristiano Ronaldo"
  // would sort by a string that is not on screen.
  const players = rankByRelevance(
    [...playerById.values()],
    trimmed,
    (player) => player.known_as ?? player.full_name,
  ).slice(0, RESULTS_PER_CATEGORY);

  const results: SearchResult[] = [];

  for (const team of rankByRelevance(teams ?? [], trimmed, (team) => team.name).slice(0, RESULTS_PER_CATEGORY)) {
    results.push({ type: "team", id: team.id, label: team.name, sublabel: team.country, imageUrl: team.crest_url });
  }
  for (const player of players) {
    results.push({
      type: "player",
      id: player.id,
      label: player.known_as ?? player.full_name,
      sublabel: [player.position, player.current_team?.name].filter(Boolean).join(" · ") || null,
      imageUrl: null,
    });
  }
  for (const competition of rankByRelevance(competitions ?? [], trimmed, (row) => row.name).slice(0, RESULTS_PER_CATEGORY)) {
    results.push({
      type: "competition",
      id: competition.id,
      label: competition.name,
      sublabel: competition.country,
      imageUrl: competition.logo_url,
    });
  }
  for (const manager of rankByRelevance(managers ?? [], trimmed, (row) => row.full_name).slice(0, RESULTS_PER_CATEGORY)) {
    results.push({
      type: "manager",
      id: manager.id,
      label: manager.full_name,
      sublabel: [manager.current_team?.name, manager.nationality].filter(Boolean).join(" · ") || null,
      imageUrl: null,
    });
  }
  for (const venue of rankByRelevance((venues ?? []).filter((row) => row.name !== null), trimmed, (row) => row.name ?? "").slice(0, RESULTS_PER_CATEGORY)) {
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
