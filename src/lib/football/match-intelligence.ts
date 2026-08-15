import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getHeadToHead, type HeadToHeadRecord } from "./head-to-head";
import {
  computeTeamForm,
  resolveFixtureResult,
  type FormSummary,
  type ResolvedResult,
  type FixtureResultRow,
} from "./form-engine";
import { summarizeGoalTiming, type TeamGoalTiming } from "./goal-timing";

/**
 * KIVO Match Intelligence — unifies H2H (`head-to-head.ts`), team form
 * (`form-engine.ts`), and goal-timing distribution (RECOMMENDATIONS.md item
 * 162) into one object for a single fixture, so consumers like the AI
 * Copilot's grounding context and a future match-preview surface share one
 * definition instead of running the same three kinds of queries ad hoc.
 *
 * Nothing here computes a new stat — goal-timing distribution already exists
 * inline in `src/app/(app)/teams/[id]/page.tsx` (goals scored after the 70th
 * minute, scoped to a team, labelled with its real finished-match sample);
 * this module extracts that exact logic into a reusable, testable form
 * (`summarizeGoalTiming`) rather than reinventing it, and reuses
 * `getHeadToHead`/`computeTeamForm` verbatim for the other two pillars.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TeamRef = { id: string; name: string };

export type { TeamGoalTiming };

export type MatchInsights = {
  fixtureId: string;
  kickoffAt: string;
  status: string;
  homeTeam: TeamRef;
  awayTeam: TeamRef;
  /** Prior meetings only (this fixture itself is excluded) — null only on a
   * malformed id pair or query error, same contract as getHeadToHead. An
   * empty `meetings` array is a real "no shared history yet" answer, not a
   * missing one. */
  headToHead: HeadToHeadRecord | null;
  /** Each team's own real recent form (last 5 finished matches), reusing
   * form-engine.ts verbatim — not reimplemented here. isSufficientSample
   * on the summary itself is the honesty gate consumers must check. */
  homeForm: FormSummary;
  awayForm: FormSummary;
  homeGoalTiming: TeamGoalTiming;
  awayGoalTiming: TeamGoalTiming;
};

async function fetchTeamForm(supabase: SupabaseClient<Database>, teamId: string): Promise<FormSummary> {
  const { data: recentFixtures } = await supabase
    .from("fixtures")
    .select("id, kickoff_at, status, home_score, away_score, home_team_id, away_team_id")
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .eq("status", "finished")
    .order("kickoff_at", { ascending: false })
    .limit(10);

  const resolved: ResolvedResult[] = ((recentFixtures ?? []) as FixtureResultRow[])
    .map((f) => resolveFixtureResult(f, teamId))
    .filter((r): r is ResolvedResult => r !== null);

  return computeTeamForm(resolved, "last5");
}

async function fetchTeamGoalTiming(supabase: SupabaseClient<Database>, teamId: string): Promise<TeamGoalTiming> {
  // Same query shape as RECOMMENDATIONS.md item 162's original inline
  // version in teams/[id]/page.tsx: goal + penalty_goal events scoped to
  // this team's own team_id, own goals excluded, unbounded (all synced
  // history for this team, not windowed like form).
  const [{ data: goalEvents }, { count: finishedMatchesCount }] = await Promise.all([
    supabase.from("fixture_events").select("minute").eq("team_id", teamId).in("event_type", ["goal", "penalty_goal"]),
    supabase
      .from("fixtures")
      .select("id", { count: "exact", head: true })
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
      .eq("status", "finished"),
  ]);

  return summarizeGoalTiming(
    (goalEvents ?? []).map((e) => e.minute),
    finishedMatchesCount ?? 0,
  );
}

/**
 * Assembles real H2H, both teams' real recent form, and both teams' real
 * goal-timing distribution for one fixture. Returns null only for a
 * malformed/nonexistent fixture id or a query error — never fabricates any
 * field; every sub-object carries its own honest sample-size gate for
 * callers to check before presenting a trend as reliable.
 */
export async function buildMatchInsights(
  supabase: SupabaseClient<Database>,
  fixtureId: string,
): Promise<MatchInsights | null> {
  if (!UUID_RE.test(fixtureId)) return null;

  const { data: fixture, error } = await supabase
    .from("fixtures")
    .select(
      `id, kickoff_at, status,
       home_team:teams!fixtures_home_team_id_fkey(id, name),
       away_team:teams!fixtures_away_team_id_fkey(id, name)`,
    )
    .eq("id", fixtureId)
    .maybeSingle();

  if (error || !fixture || !fixture.home_team || !fixture.away_team) {
    if (error) console.error("buildMatchInsights: fixture query failed", error);
    return null;
  }

  const homeTeam = fixture.home_team;
  const awayTeam = fixture.away_team;

  const [headToHead, homeForm, awayForm, homeGoalTiming, awayGoalTiming] = await Promise.all([
    getHeadToHead(supabase, homeTeam.id, awayTeam.id, { excludeFixtureId: fixture.id }),
    fetchTeamForm(supabase, homeTeam.id),
    fetchTeamForm(supabase, awayTeam.id),
    fetchTeamGoalTiming(supabase, homeTeam.id),
    fetchTeamGoalTiming(supabase, awayTeam.id),
  ]);

  return {
    fixtureId: fixture.id,
    kickoffAt: fixture.kickoff_at,
    status: fixture.status,
    homeTeam,
    awayTeam,
    headToHead,
    homeForm,
    awayForm,
    homeGoalTiming,
    awayGoalTiming,
  };
}
