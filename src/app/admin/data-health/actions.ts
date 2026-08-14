"use server";

import { revalidatePath } from "next/cache";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { syncTodayFixtures } from "@/lib/football/sync";
import { syncTeamSquad } from "@/lib/football/sync-squads";
import { syncFixtureDetails, syncStandings } from "@/lib/football/sync-match-details";
import { syncPlayerTransfers } from "@/lib/football/sync-transfers";

export async function triggerFootballSync(): Promise<{ error: string | null; recordsProcessed?: number }> {
  const profile = await getOrCreateProfile();
  if (!profile || !canManageFootballData(profile.role)) {
    return { error: "You don't have football data admin access." };
  }

  // Mirrors the guard in getFootballDataProvider(): never let a "sync" silently run
  // against the dev-only mock provider and look like a real, production sync happened.
  if (!process.env.API_FOOTBALL_KEY) {
    return { error: "No real football data provider is configured — set API_FOOTBALL_KEY before syncing." };
  }

  const result = await syncTodayFixtures();

  revalidatePath("/admin/data-health");
  revalidatePath("/matches");

  if (result.status === "failed") {
    return { error: result.error ?? "Sync failed — see the sync_runs row for details." };
  }

  return { error: null, recordsProcessed: result.recordsProcessed };
}

/** Shared auth + real-provider guard for the on-demand sync actions below —
 * identical checks to triggerFootballSync above, factored out since there are
 * now several thin action wrappers making the same two checks. */
async function requireFootballDataAccess(): Promise<{ error: string } | null> {
  const profile = await getOrCreateProfile();
  if (!profile || !canManageFootballData(profile.role)) {
    return { error: "You don't have football data admin access." };
  }
  if (!process.env.API_FOOTBALL_KEY) {
    return { error: "No real football data provider is configured — set API_FOOTBALL_KEY before syncing." };
  }
  return null;
}

/** Triggered from a team/player admin surface — e.g. an admin viewing an empty
 * player list for a team can call this to pull its squad + current manager. */
export async function triggerTeamSquadSync(teamId: string): Promise<{ error: string | null; recordsProcessed?: number }> {
  const denied = await requireFootballDataAccess();
  if (denied) return denied;

  const result = await syncTeamSquad(teamId);

  revalidatePath("/admin/data-health");

  if (result.status === "failed") {
    return { error: result.error ?? "Squad sync failed — see the sync_runs row for details." };
  }

  return { error: null, recordsProcessed: result.recordsProcessed };
}

/** Triggered from a match/fixture admin surface to pull lineups + match events. */
export async function triggerFixtureDetailsSync(
  fixtureId: string,
): Promise<{ error: string | null; recordsProcessed?: number }> {
  const denied = await requireFootballDataAccess();
  if (denied) return denied;

  const result = await syncFixtureDetails(fixtureId);

  revalidatePath("/admin/data-health");

  if (result.status === "failed") {
    return { error: result.error ?? "Fixture details sync failed — see the sync_runs row for details." };
  }

  return { error: null, recordsProcessed: result.recordsProcessed };
}

/** Triggered from a competition/standings admin surface to pull a season's table. */
export async function triggerStandingsSync(seasonId: string): Promise<{ error: string | null; recordsProcessed?: number }> {
  const denied = await requireFootballDataAccess();
  if (denied) return denied;

  const result = await syncStandings(seasonId);

  revalidatePath("/admin/data-health");

  if (result.status === "failed") {
    return { error: result.error ?? "Standings sync failed — see the sync_runs row for details." };
  }

  return { error: null, recordsProcessed: result.recordsProcessed };
}

/** Triggered from a player profile's Transfer history section to pull that
 * player's recorded transfer history. */
export async function triggerPlayerTransfersSync(playerId: string): Promise<{ error: string | null; recordsProcessed?: number }> {
  const denied = await requireFootballDataAccess();
  if (denied) return denied;

  const result = await syncPlayerTransfers(playerId);

  revalidatePath("/admin/data-health");
  revalidatePath("/transfers");
  revalidatePath(`/players/${playerId}`);

  if (result.status === "failed") {
    return { error: result.error ?? "Transfer sync failed — see the sync_runs row for details." };
  }

  return { error: null, recordsProcessed: result.recordsProcessed };
}
