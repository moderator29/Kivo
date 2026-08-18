import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { logError } from "@/lib/log";

/**
 * What the viewer's own history with a club or player actually is (KN-46).
 *
 * `/teams/[id]` and `/players/[id]` rendered identically for somebody who
 * follows the entity and somebody who has never heard of it — the only
 * difference in the entire page was whether a star was filled. In a product
 * that is now gated, and therefore knows exactly who is reading on every
 * render, that is a wasted certainty.
 *
 * Everything here is the viewer's *own* data, joined to the entity they are
 * looking at. No cross-user aggregate, nothing about anyone else, nothing
 * inferred. A count is either a real count of the reader's own rows or it is
 * absent, and every consumer renders nothing at all at zero rather than "0
 * predictions" — the same convention HeadToHeadCard and the Room activity note
 * already follow.
 *
 * Failures degrade to "no connection to report" rather than throwing: this is
 * a garnish on a page whose real subject is the club, and it must never be the
 * reason that page fails to render.
 */

type Client = SupabaseClient<Database>;

export type ViewerTeamConnection = {
  /** Predictions this viewer has made on fixtures involving this club. */
  predictionsMade: number;
  /** …of which have been scored as correct. Only ever counted from a real
   * `points_awarded > 0`, so an unscored prediction is neither right nor
   * wrong here — it is simply not counted. */
  predictionsCorrect: number;
  /** Players in the viewer's current-gameweek fantasy squad who play here. */
  fantasySquadPlayers: number;
};

const EMPTY_TEAM_CONNECTION: ViewerTeamConnection = {
  predictionsMade: 0,
  predictionsCorrect: 0,
  fantasySquadPlayers: 0,
};

export async function getViewerTeamConnection(
  supabase: Client,
  profileId: string,
  teamId: string,
): Promise<ViewerTeamConnection> {
  const [predictions, fantasy] = await Promise.all([
    // One round trip rather than "fetch this club's fixture ids, then filter
    // predictions by them": an inner-joined embedded filter pushes the whole
    // thing into a single PostgREST query, and the fixture id list for a club
    // across every synced season is unbounded.
    supabase
      .from("predictions")
      .select("points_awarded, fixture:fixtures!inner(id)")
      .eq("profile_id", profileId)
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`, { referencedTable: "fixture" }),
    // The viewer's current-gameweek squad, filtered to players whose club is
    // this one. `is_current` matters: a squad from three gameweeks ago is not
    // "your squad", it is history.
    supabase
      .from("fantasy_rosters")
      .select(
        "player_id, team:fantasy_teams!inner(owner_profile_id), gameweek:fantasy_gameweeks!inner(is_current), player:players!inner(current_team_id)",
      )
      .eq("team.owner_profile_id", profileId)
      .eq("gameweek.is_current", true)
      .eq("player.current_team_id", teamId),
  ]);

  if (predictions.error) logError("viewerConnection.teamPredictions", predictions.error, { teamId });
  if (fantasy.error) logError("viewerConnection.teamFantasy", fantasy.error, { teamId });

  const predictionRows = predictions.data ?? [];
  return {
    predictionsMade: predictionRows.length,
    predictionsCorrect: predictionRows.filter((row) => (row.points_awarded ?? 0) > 0).length,
    // A player can appear in more than one of the viewer's fantasy teams;
    // "2 of your squad play here" should mean two players, not two rows.
    fantasySquadPlayers: new Set((fantasy.data ?? []).map((row) => row.player_id)).size,
  };
}

export function hasTeamConnection(connection: ViewerTeamConnection): boolean {
  return connection.predictionsMade > 0 || connection.fantasySquadPlayers > 0;
}

export type ViewerPlayerConnection = {
  /** In the viewer's current-gameweek squad. */
  inSquad: boolean;
  isCaptain: boolean;
  isViceCaptain: boolean;
  /** In the starting XI rather than on the bench. Meaningless when
   * `inSquad` is false. */
  isStarting: boolean;
};

const EMPTY_PLAYER_CONNECTION: ViewerPlayerConnection = {
  inSquad: false,
  isCaptain: false,
  isViceCaptain: false,
  isStarting: false,
};

export async function getViewerPlayerConnection(
  supabase: Client,
  profileId: string,
  playerId: string,
): Promise<ViewerPlayerConnection> {
  const { data, error } = await supabase
    .from("fantasy_rosters")
    .select(
      "is_captain, is_vice_captain, is_starting, team:fantasy_teams!inner(owner_profile_id), gameweek:fantasy_gameweeks!inner(is_current)",
    )
    .eq("team.owner_profile_id", profileId)
    .eq("gameweek.is_current", true)
    .eq("player_id", playerId);

  if (error) {
    logError("viewerConnection.playerFantasy", error, { playerId });
    return EMPTY_PLAYER_CONNECTION;
  }

  const rows = data ?? [];
  if (rows.length === 0) return EMPTY_PLAYER_CONNECTION;

  // Across several fantasy teams the same player can hold different roles.
  // "Your captain" is the strongest true statement, so it wins.
  return {
    inSquad: true,
    isCaptain: rows.some((row) => row.is_captain),
    isViceCaptain: rows.some((row) => row.is_vice_captain),
    isStarting: rows.some((row) => row.is_starting),
  };
}

export { EMPTY_TEAM_CONNECTION, EMPTY_PLAYER_CONNECTION };
