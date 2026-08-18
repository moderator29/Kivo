import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";

/**
 * Reads for prediction leagues (KN-104).
 *
 * The leaderboard is a SECURITY DEFINER RPC because it sums other members'
 * `predictions.points_awarded`, which `predictions_select_own` correctly
 * forbids a plain query from touching. It never returns anybody's individual
 * pick — only totals — which is the same rule `get_predictions_leaderboard`
 * and `get_prediction_consensus` already follow.
 */

export type PredictionLeagueSummary = {
  id: string;
  name: string;
  inviteCode: string | null;
  memberCount: number;
  isCreator: boolean;
};

export type PredictionLeagueStanding = {
  profileId: string;
  username: string;
  displayName: string | null;
  totalPoints: number;
  settled: number;
  correct: number;
  isYou: boolean;
};

export async function getMyPredictionLeagues(profileId: string): Promise<PredictionLeagueSummary[]> {
  const supabase = createServerSupabaseClient();

  // `prediction_leagues_select_member` already restricts this to leagues the
  // caller is in or created, so there is nothing to filter here beyond the
  // join — the policy is the scope, not this query.
  const { data, error } = await supabase
    .from("prediction_league_members")
    .select("league:prediction_leagues!inner(id, name, invite_code, creator_profile_id)")
    .eq("profile_id", profileId)
    .order("joined_at", { ascending: false });

  if (error) {
    logError("predictions.myLeagues", error, { profileId });
    return [];
  }

  const leagues = (data ?? []).flatMap((row) => (row.league ? [row.league] : []));
  if (leagues.length === 0) return [];

  // One round trip for every league's member count rather than one each.
  const { data: memberRows } = await supabase
    .from("prediction_league_members")
    .select("league_id")
    .in(
      "league_id",
      leagues.map((league) => league.id),
    );

  const countByLeague = new Map<string, number>();
  for (const row of memberRows ?? []) {
    countByLeague.set(row.league_id, (countByLeague.get(row.league_id) ?? 0) + 1);
  }

  return leagues.map((league) => ({
    id: league.id,
    name: league.name,
    // The invite code is only shown to the person who can legitimately share
    // it. Everyone else sees the league without a way to hand it around.
    inviteCode: league.creator_profile_id === profileId ? league.invite_code : null,
    memberCount: countByLeague.get(league.id) ?? 0,
    isCreator: league.creator_profile_id === profileId,
  }));
}

export async function getPredictionLeagueStandings(leagueId: string): Promise<PredictionLeagueStanding[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_prediction_league_leaderboard", { p_league_id: leagueId });

  if (error) {
    // Includes the deliberate "you are not a member of that league" raise,
    // which is a correct refusal rather than a fault — logged at the same
    // level either way, because a member seeing this would be a real bug.
    logError("predictions.leagueStandings", error, { leagueId });
    return [];
  }

  return (data ?? []).map((row) => ({
    profileId: row.profile_id,
    username: row.username,
    displayName: row.display_name,
    totalPoints: row.total_points,
    settled: row.settled,
    correct: row.correct,
    isYou: row.is_you,
  }));
}
