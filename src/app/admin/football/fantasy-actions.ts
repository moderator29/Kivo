"use server";

import { revalidatePath } from "next/cache";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { groupFixturesByGameweek } from "@/lib/fantasy";
import { logError } from "@/lib/log";
import { runGameweekScoring, type ScoreFantasyGameweekResult } from "@/lib/fantasy-gameweek-scoring";

// Re-exported so the existing importer (components/admin/score-fantasy-gameweek-button.tsx)
// keeps working — the type moved with the scorer, not with the action.
export type { ScoreFantasyGameweekResult };

/**
 * Derives fantasy_gameweeks rows from a season's real synced fixtures —
 * nothing invented, no cron. Grouped by the provider's own `matchday` when
 * every fixture in the season has one (the common case for league
 * competitions); falls back to bucketing by calendar week from the season's
 * first kickoff when `matchday` is null (e.g. cup competitions), renumbered
 * 1..N in chronological order. Each gameweek's deadline is the earliest
 * kickoff within its group, matching how submitPrediction-style deadline
 * enforcement already works elsewhere in this codebase. Existing gameweek
 * rows are never touched (an admin may have hand-adjusted a deadline), only
 * missing numbers are inserted.
 */
export async function generateFantasyGameweeks(
  seasonId: string,
): Promise<{ error: string | null; recordsProcessed?: number }> {
  const profile = await getOrCreateProfile();
  if (!profile || !canManageFootballData(profile.role)) {
    return { error: "You don't have football data admin access." };
  }

  const supabase = createServerSupabaseClient();
  const { data: fixtures, error: fixturesError } = await supabase
    .from("fixtures")
    .select("id, matchday, kickoff_at")
    .eq("season_id", seasonId)
    .order("kickoff_at", { ascending: true });

  if (fixturesError) {
    logError("admin.football.fantasy-actions.loadFixturesGameweekGeneration", fixturesError);
    return { error: "Couldn't load this season's fixtures. Try again." };
  }

  if (!fixtures || fixtures.length === 0) {
    return { error: "This season has no synced fixtures yet. Sync fixtures before generating gameweeks." };
  }

  const groups = groupFixturesByGameweek(fixtures);

  const { data: existingGameweeks, error: existingError } = await supabase
    .from("fantasy_gameweeks")
    .select("number")
    .eq("season_id", seasonId);

  if (existingError) {
    logError("admin.football.fantasy-actions.loadExistingGameweeks", existingError);
    return { error: "Couldn't check existing gameweeks. Try again." };
  }

  const existingNumbers = new Set((existingGameweeks ?? []).map((g) => g.number));
  const toInsert = [...groups.values()]
    .filter((g) => !existingNumbers.has(g.number))
    .map((g) => ({ season_id: seasonId, number: g.number, deadline_at: g.deadlineAt }));

  if (toInsert.length > 0) {
    const { error: insertError } = await supabase.from("fantasy_gameweeks").insert(toInsert);
    if (insertError) {
      logError("admin.football.fantasy-actions.insertFantasyGameweeks", insertError);
      return { error: "Couldn't create gameweeks. Try again." };
    }
  }

  // Pick the gameweek to mark current: the earliest deadline still in the
  // future, or (season fully finished) the latest deadline overall, so the
  // squad builder always has something to show rather than "no gameweek".
  const now = new Date().toISOString();
  const { data: allGameweeks, error: allError } = await supabase
    .from("fantasy_gameweeks")
    .select("id, deadline_at")
    .eq("season_id", seasonId)
    .order("deadline_at", { ascending: true });

  if (!allError && allGameweeks && allGameweeks.length > 0) {
    const upcoming = allGameweeks.find((g) => g.deadline_at > now);
    const target = upcoming ?? allGameweeks[allGameweeks.length - 1];

    await supabase
      .from("fantasy_gameweeks")
      .update({ is_current: false })
      .eq("season_id", seasonId)
      .eq("is_current", true)
      .neq("id", target.id);

    await supabase.from("fantasy_gameweeks").update({ is_current: true }).eq("id", target.id).eq("is_current", false);
  }

  await logAudit(profile.id, "generate_fantasy_gameweeks", "fantasy_gameweeks", {
    seasonId,
    recordsProcessed: toInsert.length,
  });

  revalidatePath("/fantasy");
  revalidatePath("/admin/football", "layout");

  return { error: null, recordsProcessed: toInsert.length };
}




/**
 * On-demand admin pass, same shape as scorePredictions() in
 * predictions-actions.ts: an admin triggers it for one gameweek at a time
 * (fantasy scoring has no natural "score everything" target the way
 * predictions does, since a gameweek's fixtures finish on their own
 * schedule), it computes real points from already-synced fixture_events on
 * finished fixtures only, and it upserts one fantasy_points row per
 * fantasy_team_id — never fabricating a score for a fixture that hasn't
 * been played. Re-running it for the same gameweek (e.g. after more of its
 * fixtures finish) recomputes and overwrites, which is safe: the upsert is
 * keyed on fantasy_points_unique_team_gameweek, and this action always
 * starts its sums from zero rather than incrementing.
 *
 * See src/lib/fantasy-scoring.ts for the full rule set and its documented
 * "captain playing" limitation. Runs under the service-role client because
 * it writes fantasy_rosters/fantasy_points rows belonging to every team in
 * the gameweek, not just the admin's own (fantasy_rosters_all_own and
 * fantasy_points' owner-only select policy would otherwise hide them).
 */
/**
 * Admin-triggered scoring for one gameweek.
 *
 * Thin on purpose: the whole computation lives in
 * `src/lib/fantasy-gameweek-scoring.ts`, because that module is `server-only`
 * rather than `"use server"` and therefore cannot be invoked from a browser.
 * A scorer that a background worker can call must not also be a server action,
 * and this file is a server-action file — every export in it is a POST endpoint.
 *
 * What stays here is what genuinely belongs to the ADMIN act rather than to the
 * scoring: the permission check, the audit record of who ran it, and the cache
 * invalidation for the pages an admin expects to see change.
 */
export async function scoreFantasyGameweek(gameweekId: string): Promise<ScoreFantasyGameweekResult> {
  const profile = await getOrCreateProfile();
  if (!profile || !canManageFootballData(profile.role)) {
    return { error: "You don't have football data admin access." };
  }

  const result = await runGameweekScoring(gameweekId);
  if (result.error) return result;

  await logAudit(profile.id, "score_fantasy_gameweek", "fantasy_points", {
    gameweekId,
    fixturesConsidered: result.fixturesTotal ?? 0,
    fixturesFinished: result.fixturesFinished ?? 0,
    fixturesWithEvents: result.fixturesWithEvents ?? 0,
    status: result.status ?? null,
    recordsProcessed: result.recordsProcessed ?? 0,
    playersRepriced: result.playersRepriced ?? 0,
  });

  revalidatePath("/fantasy");
  revalidatePath("/admin/football", "layout");
  // Concrete per-page revalidation for the players whose price actually moved —
  // never the wildcard `/players/[id]` segment form, which would drop the cache
  // for every player page regardless. Bounded by this run's real repriced count.
  for (const playerId of result.repricedPlayerIds ?? []) revalidatePath(`/players/${playerId}`);

  return result;
}
