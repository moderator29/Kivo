"use server";

import { revalidatePath } from "next/cache";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { awardBadge } from "@/lib/rewards";
import { groupFixturesByGameweek } from "@/lib/fantasy";
import {
  computePlayerMatchFacts,
  emptyPlayerMatchFacts,
  scoreRosterSlot,
  type FinishedFixtureFacts,
} from "@/lib/fantasy-scoring";

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
    console.error("Failed to load fixtures for gameweek generation", fixturesError);
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
    console.error("Failed to load existing gameweeks", existingError);
    return { error: "Couldn't check existing gameweeks. Try again." };
  }

  const existingNumbers = new Set((existingGameweeks ?? []).map((g) => g.number));
  const toInsert = [...groups.values()]
    .filter((g) => !existingNumbers.has(g.number))
    .map((g) => ({ season_id: seasonId, number: g.number, deadline_at: g.deadlineAt }));

  if (toInsert.length > 0) {
    const { error: insertError } = await supabase.from("fantasy_gameweeks").insert(toInsert);
    if (insertError) {
      console.error("Failed to insert fantasy gameweeks", insertError);
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
  revalidatePath("/admin/data-health");

  return { error: null, recordsProcessed: toInsert.length };
}

export type ScoreFantasyGameweekResult = {
  error: string | null;
  recordsProcessed?: number;
  fixturesFinished?: number;
  fixturesTotal?: number;
};

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
export async function scoreFantasyGameweek(gameweekId: string): Promise<ScoreFantasyGameweekResult> {
  const profile = await getOrCreateProfile();
  if (!profile || !canManageFootballData(profile.role)) {
    return { error: "You don't have football data admin access." };
  }

  const supabase = createServerSupabaseClient();

  const { data: gameweek, error: gwError } = await supabase
    .from("fantasy_gameweeks")
    .select("id, season_id, number")
    .eq("id", gameweekId)
    .maybeSingle();
  if (gwError || !gameweek) {
    return { error: "That gameweek doesn't exist." };
  }

  // Same source and ordering generateFantasyGameweeks used to create this
  // gameweek's row in the first place — see groupFixturesByGameweek's doc
  // comment for why this has to target the identical fixture set.
  const { data: seasonFixtures, error: fixturesError } = await supabase
    .from("fixtures")
    .select("id, matchday, kickoff_at, status, home_team_id, away_team_id, home_score, away_score")
    .eq("season_id", gameweek.season_id)
    .order("kickoff_at", { ascending: true });

  if (fixturesError) {
    console.error("Failed to load fixtures for gameweek scoring", fixturesError);
    return { error: "Couldn't load this season's fixtures. Try again." };
  }
  if (!seasonFixtures || seasonFixtures.length === 0) {
    return { error: "This season has no synced fixtures yet." };
  }

  const groups = groupFixturesByGameweek(seasonFixtures);
  const group = groups.get(gameweek.number);
  if (!group || group.fixtureIds.length === 0) {
    return { error: "Couldn't find this gameweek's fixtures. Try re-running Generate gameweeks." };
  }

  const groupFixtureIds = new Set(group.fixtureIds);
  const fixturesInGroup = seasonFixtures.filter((f) => groupFixtureIds.has(f.id));
  const finishedFixtures = fixturesInGroup.filter(
    (f) => f.status === "finished" && f.home_score !== null && f.away_score !== null,
  );

  if (finishedFixtures.length === 0) {
    return { error: null, recordsProcessed: 0, fixturesFinished: 0, fixturesTotal: fixturesInGroup.length };
  }

  const finishedFixtureIds = finishedFixtures.map((f) => f.id);
  const finishedFixtureFacts: FinishedFixtureFacts[] = finishedFixtures.map((f) => ({
    id: f.id,
    homeTeamId: f.home_team_id,
    awayTeamId: f.away_team_id,
    homeScore: f.home_score as number,
    awayScore: f.away_score as number,
  }));

  const service = createServiceRoleSupabaseClient();

  const { data: events, error: eventsError } = await service
    .from("fixture_events")
    .select("fixture_id, player_id, related_player_id, event_type")
    .in("fixture_id", finishedFixtureIds);
  if (eventsError) {
    console.error("Failed to load fixture events for gameweek scoring", eventsError);
    return { error: "Couldn't load match events. Try again." };
  }

  const { data: rosterRows, error: rosterError } = await service
    .from("fantasy_rosters")
    .select("fantasy_team_id, player_id, is_starting, is_captain, is_vice_captain")
    .eq("gameweek_id", gameweekId);
  if (rosterError) {
    console.error("Failed to load fantasy rosters for gameweek scoring", rosterError);
    return { error: "Couldn't load fantasy squads. Try again." };
  }

  const rosters = rosterRows ?? [];
  if (rosters.length === 0) {
    return { error: null, recordsProcessed: 0, fixturesFinished: finishedFixtures.length, fixturesTotal: fixturesInGroup.length };
  }

  const rosteredPlayerIds = [...new Set(rosters.map((r) => r.player_id))];
  const { data: players, error: playersError } = await service
    .from("players")
    .select("id, position, current_team_id")
    .in("id", rosteredPlayerIds);
  if (playersError) {
    console.error("Failed to load players for gameweek scoring", playersError);
    return { error: "Couldn't load player data. Try again." };
  }

  const playerById = new Map((players ?? []).map((p) => [p.id, p]));
  // Player's team, for crediting clean sheets — current_team_id is the same
  // "player's team" signal the rest of the fantasy UI already relies on
  // (see fantasy-builder's roster join in src/app/(app)/fantasy/page.tsx).
  const playerTeamId = new Map(
    (players ?? []).filter((p) => p.current_team_id).map((p) => [p.id, p.current_team_id as string]),
  );

  const facts = computePlayerMatchFacts(events ?? [], finishedFixtureFacts, playerTeamId);

  // See fantasy-scoring.ts's LIMITATION note: "did the captain play" is
  // approximated by the captain's own fantasy_rosters.is_starting flag for
  // this gameweek. A team with no captain set defaults to "didn't play" so
  // its vice-captain (if any) still gets a shot at the double.
  const captainStartingByTeam = new Map<string, boolean>();
  for (const row of rosters) {
    if (row.is_captain) captainStartingByTeam.set(row.fantasy_team_id, row.is_starting);
  }

  const pointsByTeam = new Map<string, number>();
  for (const row of rosters) {
    if (!pointsByTeam.has(row.fantasy_team_id)) pointsByTeam.set(row.fantasy_team_id, 0);

    const player = playerById.get(row.player_id);
    const playerFacts = facts.get(row.player_id) ?? emptyPlayerMatchFacts();
    const captainStarted = captainStartingByTeam.get(row.fantasy_team_id) ?? false;

    const slotPoints = scoreRosterSlot(playerFacts, player?.position ?? null, {
      isStarting: row.is_starting,
      isCaptain: row.is_captain,
      doubleAsVice: row.is_vice_captain && !captainStarted,
    });

    pointsByTeam.set(row.fantasy_team_id, pointsByTeam.get(row.fantasy_team_id)! + slotPoints);
  }

  const upsertRows = [...pointsByTeam.entries()].map(([fantasy_team_id, points]) => ({
    fantasy_team_id,
    gameweek_id: gameweekId,
    points,
  }));

  const { error: upsertError } = await service
    .from("fantasy_points")
    .upsert(upsertRows, { onConflict: "fantasy_team_id,gameweek_id" });
  if (upsertError) {
    console.error("Failed to write fantasy points", upsertError);
    return { error: "Couldn't save fantasy points. Try again." };
  }

  // "Scored" means a real positive fantasy_points row just written above —
  // never awarded for a zero or unplayed gameweek. Resolve team -> owner via
  // fantasy_teams (fantasy_points has no profile_id column of its own).
  const scoringTeamIds = upsertRows.filter((r) => r.points > 0).map((r) => r.fantasy_team_id);
  if (scoringTeamIds.length > 0) {
    const { data: scoringTeams, error: scoringTeamsError } = await service
      .from("fantasy_teams")
      .select("id, owner_profile_id")
      .in("id", scoringTeamIds);
    if (scoringTeamsError) {
      console.error("Failed to load fantasy team owners for badge awarding", scoringTeamsError);
    } else {
      await Promise.all((scoringTeams ?? []).map((t) => awardBadge(t.owner_profile_id, "fantasy_gameweek_scored")));
    }
  }

  await logAudit(profile.id, "score_fantasy_gameweek", "fantasy_points", {
    gameweekId,
    gameweekNumber: gameweek.number,
    fixturesConsidered: fixturesInGroup.length,
    fixturesFinished: finishedFixtures.length,
    recordsProcessed: upsertRows.length,
  });

  revalidatePath("/fantasy");
  revalidatePath("/admin/data-health");

  return {
    error: null,
    recordsProcessed: upsertRows.length,
    fixturesFinished: finishedFixtures.length,
    fixturesTotal: fixturesInGroup.length,
  };
}
