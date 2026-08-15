import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

// Duplicated locally rather than imported, matching the existing convention
// (params.ts and /transfers/page.tsx each keep their own copy too) — this one
// validates and returns a boolean rather than calling notFound(), which the
// other two don't need.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type HeadToHeadMeeting = {
  id: string;
  kickoffAt: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
};

export type HeadToHeadRecord = {
  meetings: HeadToHeadMeeting[];
  teamAWins: number;
  teamBWins: number;
  draws: number;
  teamAGoals: number;
  teamBGoals: number;
};

/**
 * All finished meetings between two teams, in either home/away direction
 * (RECOMMENDATIONS.md item 161). `excludeFixtureId` lets Match Centre ask
 * for "prior" meetings only, leaving out the very fixture whose score it's
 * already showing.
 *
 * Team ids are interpolated into a raw `.or()` filter string — PostgREST has
 * no bound-parameter form of a cross-column OR — so both are validated as
 * real UUIDs first, same rule /transfers' club filter follows for the same
 * reason.
 *
 * Returns null only on a malformed id pair or a query error; a real pair
 * with zero shared history returns a record with an empty `meetings` array,
 * which callers render as an honest "no synced meetings yet" state rather
 * than hiding the section outright.
 */
export async function getHeadToHead(
  supabase: SupabaseClient<Database>,
  teamAId: string,
  teamBId: string,
  options: { excludeFixtureId?: string } = {},
): Promise<HeadToHeadRecord | null> {
  if (!UUID_RE.test(teamAId) || !UUID_RE.test(teamBId) || teamAId === teamBId) return null;

  let request = supabase
    .from("fixtures")
    .select("id, kickoff_at, home_team_id, away_team_id, home_score, away_score")
    .eq("status", "finished")
    .or(
      `and(home_team_id.eq.${teamAId},away_team_id.eq.${teamBId}),and(home_team_id.eq.${teamBId},away_team_id.eq.${teamAId})`,
    )
    .order("kickoff_at", { ascending: false });

  if (options.excludeFixtureId && UUID_RE.test(options.excludeFixtureId)) {
    request = request.neq("id", options.excludeFixtureId);
  }

  const { data, error } = await request;
  if (error) {
    console.error("getHeadToHead: fixtures query failed", error);
    return null;
  }

  const rows = (data ?? []).filter(
    (f): f is typeof f & { home_score: number; away_score: number } =>
      f.home_score !== null && f.away_score !== null,
  );

  let teamAWins = 0;
  let teamBWins = 0;
  let draws = 0;
  let teamAGoals = 0;
  let teamBGoals = 0;

  for (const fixture of rows) {
    const aIsHome = fixture.home_team_id === teamAId;
    const aScore = aIsHome ? fixture.home_score : fixture.away_score;
    const bScore = aIsHome ? fixture.away_score : fixture.home_score;
    teamAGoals += aScore;
    teamBGoals += bScore;
    if (aScore > bScore) teamAWins += 1;
    else if (aScore < bScore) teamBWins += 1;
    else draws += 1;
  }

  return {
    meetings: rows.map((f) => ({
      id: f.id,
      kickoffAt: f.kickoff_at,
      homeTeamId: f.home_team_id,
      awayTeamId: f.away_team_id,
      homeScore: f.home_score,
      awayScore: f.away_score,
    })),
    teamAWins,
    teamBWins,
    draws,
    teamAGoals,
    teamBGoals,
  };
}
