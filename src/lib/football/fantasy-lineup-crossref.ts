import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type ServerClient = SupabaseClient<Database>;

export type ViewerFantasyRosterFlags = { isCaptain: boolean };

/** playerId -> whether that player is the viewer's captain in this season
 * (true if captain on *any* of the viewer's own teams for the season — a
 * user can belong to more than one league for the same season). */
export type ViewerFantasyRosterMap = Map<string, ViewerFantasyRosterFlags>;

// A user could in principle join a large number of public leagues (migration
// 0027) — cap how many of their own fantasy_teams rows this resolves per
// call, same defensive-batch-cap convention as MAX_ENSURE_BATCH in
// src/lib/fantasy.ts, rather than an unbounded per-team RPC fan-out.
const MAX_TEAMS_TO_CHECK = 40;

/**
 * RECOMMENDATIONS.md items 294/297: real join chain, shared by both —
 * Match Centre's "In your XI" Lineups pill (294) and /live's per-fixture
 * "N of your fantasy players are in this match" count (297) are the same
 * underlying cross-reference, just rendered at different granularity, so
 * both read through this one function rather than two drifting copies.
 *
 * The viewer's own fantasy_teams (owner-only RLS: fantasy_teams_all_own) ->
 * each team's fantasy_leagues.season_id -> that season's current
 * fantasy_gameweeks row -> fantasy_rosters' starting XI for that
 * team/gameweek -> player_id. Batched across every requested season id in a
 * bounded, fixed number of round trips, so a caller checking many fixtures
 * across a handful of distinct seasons (e.g. /live's fixture list) doesn't
 * pay a per-fixture query.
 *
 * fantasy_leagues is owner-only for its *creator* (fantasy_leagues_all_own)
 * — a team owner who *joined* a league via an invite code can't read that
 * league's season_id through a plain embedded join, so this resolves each
 * of the viewer's own teams' season_id through the existing
 * get_fantasy_team_league SECURITY DEFINER RPC (0009_fantasy_team_league_
 * context.sql), the same ownership-checked escape hatch /fantasy's own page
 * already uses for exactly this reason — never by widening that table's RLS.
 *
 * Must be called with the ordinary per-request client (not a service-role
 * one): every RLS policy and the RPC itself resolve the caller from
 * private.current_profile_id(), which only exists inside an authenticated
 * request's own Postgres role.
 */
export async function getViewerFantasyRosterBySeasons(
  supabase: ServerClient,
  profileId: string,
  seasonIds: string[],
): Promise<Map<string, ViewerFantasyRosterMap>> {
  const result = new Map<string, ViewerFantasyRosterMap>();
  const uniqueSeasonIds = new Set(seasonIds);
  if (uniqueSeasonIds.size === 0) return result;

  const { data: teams } = await supabase
    .from("fantasy_teams")
    .select("id")
    .eq("owner_profile_id", profileId)
    .limit(MAX_TEAMS_TO_CHECK);
  if (!teams || teams.length === 0) return result;

  const leagueLookups = await Promise.all(
    teams.map((t) => supabase.rpc("get_fantasy_team_league", { p_team_id: t.id })),
  );

  // Only the viewer's own teams whose league's season is one of the seasons
  // the caller actually asked about — most of a user's fantasy teams (other
  // competitions, other seasons) are irrelevant to any one fixture.
  const teamIdsBySeasonId = new Map<string, string[]>();
  leagueLookups.forEach((lookup, index) => {
    const seasonId = lookup.data?.[0]?.season_id;
    if (!seasonId || !uniqueSeasonIds.has(seasonId)) return;
    const teamId = teams[index].id;
    const list = teamIdsBySeasonId.get(seasonId);
    if (list) list.push(teamId);
    else teamIdsBySeasonId.set(seasonId, [teamId]);
  });
  if (teamIdsBySeasonId.size === 0) return result;

  const relevantSeasonIds = [...teamIdsBySeasonId.keys()];
  const { data: gameweeks } = await supabase
    .from("fantasy_gameweeks")
    .select("id, season_id")
    .in("season_id", relevantSeasonIds)
    .eq("is_current", true);
  if (!gameweeks || gameweeks.length === 0) return result;

  const seasonIdByGameweekId = new Map(gameweeks.map((g) => [g.id, g.season_id]));
  const allTeamIds = [...teamIdsBySeasonId.values()].flat();
  const allGameweekIds = gameweeks.map((g) => g.id);

  const { data: rosterRows } = await supabase
    .from("fantasy_rosters")
    .select("gameweek_id, player_id, is_captain")
    .in("fantasy_team_id", allTeamIds)
    .in("gameweek_id", allGameweekIds)
    .eq("is_starting", true);
  if (!rosterRows || rosterRows.length === 0) return result;

  for (const row of rosterRows) {
    const seasonId = seasonIdByGameweekId.get(row.gameweek_id);
    if (!seasonId) continue;
    let seasonMap = result.get(seasonId);
    if (!seasonMap) {
      seasonMap = new Map();
      result.set(seasonId, seasonMap);
    }
    const existing = seasonMap.get(row.player_id);
    seasonMap.set(row.player_id, { isCaptain: Boolean(existing?.isCaptain || row.is_captain) });
  }

  return result;
}
