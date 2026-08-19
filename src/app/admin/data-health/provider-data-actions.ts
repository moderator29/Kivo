"use server";

import { revalidatePath } from "next/cache";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { syncProviderCoverage, reconcileCoverageCompetitions } from "@/lib/football/sync-coverage";
import { syncCompetitionInjuries } from "@/lib/football/sync-injuries";
import { syncCompetitionTopScorers } from "@/lib/football/sync-top-scorers";
import {
  syncPlayerSeasonStatistics,
  reconcilePlayerSeasonCompetitions,
} from "@/lib/football/sync-player-season-statistics";
import { syncFixturePlayerStatistics } from "@/lib/football/sync-fixture-player-statistics";

/**
 * Admin triggers for the data categories added by migrations 0081-0083.
 *
 * A separate file from `actions.ts` rather than an addition to it: that file is
 * being edited by several agents on this branch tonight, and five new exports
 * appended to a hot file is how a merge quietly drops one of them. Same guard,
 * same shape, same return contract — nothing here behaves differently from the
 * actions next door.
 *
 * ## Every one of these is manual, and that is the design
 *
 * Each spends provider quota against a hundred requests a day. None of them is
 * wired to a page load or a schedule, because the cost of a sync should be a
 * function of somebody deciding to spend it, not of how many people browse. The
 * two reconciliation actions are the exceptions in the other direction — they
 * make no provider calls at all and are free to run as often as anyone likes.
 */
async function requireFootballDataAccess(): Promise<{ error: string } | null> {
  const profile = await getOrCreateProfile();
  if (!profile || !canManageFootballData(profile.role)) {
    return { error: "You don't have football data admin access." };
  }
  if (!process.env.API_FOOTBALL_KEY) {
    return { error: "No real football data provider is configured. Set API_FOOTBALL_KEY before syncing." };
  }
  return null;
}

type ActionResult = { error: string | null; recordsProcessed?: number };

/**
 * Refreshes the coverage registry for a season.
 *
 * The single highest-value request available: one call returns what the
 * provider supports for EVERY competition it can see, which is what lets every
 * empty tab in KIVO say whether waiting will help. Run this first on a fresh
 * deployment — several other syncs consult it before they spend anything.
 */
export async function triggerCoverageSync(season?: number): Promise<ActionResult> {
  const denied = await requireFootballDataAccess();
  if (denied) return denied;

  const result = await syncProviderCoverage(season);

  revalidatePath("/admin/data-health");
  revalidatePath("/leagues");
  revalidatePath("/transparency");

  if (result.status === "failed") {
    return { error: result.error ?? "Coverage sync failed. See the sync_runs row for details." };
  }
  return { error: null, recordsProcessed: result.recordsProcessed };
}

/** Links coverage rows to competitions synced since they were written. No
 * provider calls, so this costs nothing and is safe to run repeatedly. */
export async function reconcileCoverage(): Promise<ActionResult> {
  const profile = await getOrCreateProfile();
  if (!profile || !canManageFootballData(profile.role)) {
    return { error: "You don't have football data admin access." };
  }

  const result = await reconcileCoverageCompetitions();
  revalidatePath("/admin/data-health");
  revalidatePath("/leagues");
  return result;
}

/** Absence reports for one competition. Skips without spending a request when
 * the registry says this competition publishes none. */
export async function triggerInjuriesSync(competitionId: string, season?: number): Promise<ActionResult> {
  const denied = await requireFootballDataAccess();
  if (denied) return denied;

  const result = await syncCompetitionInjuries(competitionId, season);

  revalidatePath("/admin/data-health");
  revalidatePath(`/leagues/${competitionId}`);
  // Absences surface on club and player pages, which is where a reader will
  // look for them — revalidated broadly rather than per team, since one sync
  // touches every club in the competition.
  revalidatePath("/teams", "layout");
  revalidatePath("/players", "layout");

  if (result.status === "failed") {
    return { error: result.error ?? "Injury sync failed. See the sync_runs row for details." };
  }
  return { error: null, recordsProcessed: result.recordsProcessed };
}

/** The competition's scoring chart. */
export async function triggerTopScorersSync(competitionId: string, season?: number): Promise<ActionResult> {
  const denied = await requireFootballDataAccess();
  if (denied) return denied;

  const result = await syncCompetitionTopScorers(competitionId, season);

  revalidatePath("/admin/data-health");
  revalidatePath(`/leagues/${competitionId}`);

  if (result.status === "failed") {
    return { error: result.error ?? "Top scorers sync failed. See the sync_runs row for details." };
  }
  return { error: null, recordsProcessed: result.recordsProcessed };
}

/** One player's season aggregates, split per competition. */
export async function triggerPlayerSeasonStatisticsSync(playerId: string, season?: number): Promise<ActionResult> {
  const denied = await requireFootballDataAccess();
  if (denied) return denied;

  const result = await syncPlayerSeasonStatistics(playerId, season);

  revalidatePath("/admin/data-health");
  revalidatePath(`/players/${playerId}`);

  if (result.status === "failed") {
    return { error: result.error ?? "Season statistics sync failed. See the sync_runs row for details." };
  }
  return { error: null, recordsProcessed: result.recordsProcessed };
}

/** Links season-statistics rows to competitions synced since. No provider calls. */
export async function reconcileSeasonStatistics(): Promise<ActionResult> {
  const profile = await getOrCreateProfile();
  if (!profile || !canManageFootballData(profile.role)) {
    return { error: "You don't have football data admin access." };
  }

  const result = await reconcilePlayerSeasonCompetitions();
  revalidatePath("/admin/data-health");
  revalidatePath("/players", "layout");
  return result;
}

/**
 * One fixture's per-player statistics — the heatmap's richer event basis, and
 * the real source for per-player match numbers.
 *
 * Deliberately not folded into `triggerFixtureDetailsSync`: it is a fourth
 * provider request on top of that action's three, which would cut the number of
 * matches a day's quota can cover by a quarter. Spending it is a decision, so
 * it is a button.
 *
 * Writing here also clears this fixture's cached heatmaps, because their inputs
 * have genuinely changed — see `syncFixturePlayerStatistics`.
 */
export async function triggerFixturePlayerStatisticsSync(fixtureId: string): Promise<ActionResult> {
  const denied = await requireFootballDataAccess();
  if (denied) return denied;

  const result = await syncFixturePlayerStatistics(fixtureId);

  revalidatePath("/admin/data-health");
  revalidatePath(`/matches/${fixtureId}`);

  if (result.status === "failed") {
    return { error: result.error ?? "Player match statistics sync failed. See the sync_runs row for details." };
  }
  return { error: null, recordsProcessed: result.recordsProcessed };
}
