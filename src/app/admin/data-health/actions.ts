"use server";

import { revalidatePath } from "next/cache";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { FOOTBALL_LIVE_POLLING_ENABLED } from "@/lib/football";
import { syncTodayFixtures } from "@/lib/football/sync";
import { syncTeamSquad } from "@/lib/football/sync-squads";
import { syncFixtureDetails, syncStandings } from "@/lib/football/sync-match-details";
import { syncPlayerTransfers, reconcileUnresolvedTransferTeams } from "@/lib/football/sync-transfers";

export async function triggerFootballSync(): Promise<{ error: string | null; recordsProcessed?: number }> {
  const profile = await getOrCreateProfile();
  if (!profile || !canManageFootballData(profile.role)) {
    return { error: "You don't have football data admin access." };
  }

  // Mirrors the guard in getFootballDataProvider(): never let a "sync" silently run
  // against the dev-only mock provider and look like a real, production sync happened.
  if (!process.env.API_FOOTBALL_KEY) {
    return { error: "No real football data provider is configured. Set API_FOOTBALL_KEY before syncing." };
  }

  const result = await syncTodayFixtures();

  revalidatePath("/admin/data-health");
  revalidatePath("/matches");

  if (result.status === "failed") {
    return { error: result.error ?? "Sync failed. See the sync_runs row for details." };
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
    return { error: "No real football data provider is configured. Set API_FOOTBALL_KEY before syncing." };
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
  // RECOMMENDATIONS.md item 99: this is the public page InlineSyncButton
  // actually renders on (teams/[id]/page.tsx) — without revalidating it
  // too, router.refresh() re-fetches a payload the framework never marked
  // stale, so the admin's "Sync now" click looked like it did nothing.
  // Mirrors triggerPlayerTransfersSync's revalidatePath(`/players/${id}`) below.
  revalidatePath(`/teams/${teamId}`);

  if (result.status === "failed") {
    return { error: result.error ?? "Squad sync failed. See the sync_runs row for details." };
  }

  return { error: null, recordsProcessed: result.recordsProcessed };
}

/**
 * Triggered from a match/fixture admin surface to pull lineups + match events.
 * `autoSyncMissingSquads` defaults to false (RECOMMENDATIONS.md item 59) —
 * syncFixtureDetails itself now requires the admin to opt in before it will
 * spend the 2+ extra provider calls a first-time squad sync costs per unseen
 * team, rather than silently doing it on every "sync match details" click.
 */
export async function triggerFixtureDetailsSync(
  fixtureId: string,
  autoSyncMissingSquads = false,
): Promise<{ error: string | null; recordsProcessed?: number }> {
  const denied = await requireFootballDataAccess();
  if (denied) return denied;

  const result = await syncFixtureDetails(fixtureId, { autoSyncMissingSquads });

  revalidatePath("/admin/data-health");
  // RECOMMENDATIONS.md item 99: same gap as triggerTeamSquadSync above — this
  // is the public Match Centre page FixtureDetailsSyncControl actually
  // renders on, and without revalidating it too, the admin's own
  // router.refresh() re-fetched a payload the framework never marked stale.
  revalidatePath(`/matches/${fixtureId}`);

  if (result.status === "failed") {
    return { error: result.error ?? "Fixture details sync failed. See the sync_runs row for details." };
  }

  return { error: null, recordsProcessed: result.recordsProcessed };
}

/** Triggered from a competition/standings admin surface to pull a season's table. */
export async function triggerStandingsSync(seasonId: string): Promise<{ error: string | null; recordsProcessed?: number }> {
  const denied = await requireFootballDataAccess();
  if (denied) return denied;

  const result = await syncStandings(seasonId);

  revalidatePath("/admin/data-health");
  // RECOMMENDATIONS.md item 99: same gap as triggerTeamSquadSync/
  // triggerFixtureDetailsSync above, for the public leagues/[id] page's own
  // InlineSyncButton. syncStandings only takes a seasonId, and leagues/[id]
  // is keyed by competition id, so this looks the season's competition up
  // rather than skip the revalidation — seasons carries no RLS restriction
  // (same public-football-data class as teams/competitions), so the
  // service-role client already used elsewhere on this page is fine here too.
  const { data: season } = await createServiceRoleSupabaseClient()
    .from("seasons")
    .select("competition_id")
    .eq("id", seasonId)
    .maybeSingle();
  if (season) revalidatePath(`/leagues/${season.competition_id}`);

  if (result.status === "failed") {
    return { error: result.error ?? "Standings sync failed. See the sync_runs row for details." };
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
    return { error: result.error ?? "Transfer sync failed. See the sync_runs row for details." };
  }

  return { error: null, recordsProcessed: result.recordsProcessed };
}

/**
 * On-demand retention sweep for RECOMMENDATIONS item 48: sync_runs grows
 * without bound and each row's error_message can hold up to twenty
 * concatenated failures (see syncTodayFixtures/syncTeamSquad/etc in
 * src/lib/football/sync*.ts), so an admin triggers this to prune history
 * older than 90 days rather than a cron (this codebase has zero scheduled
 * jobs by design). Deletion happens inside prune_sync_runs(), a SECURITY
 * DEFINER SQL function granted only to service_role (see
 * supabase/migrations/0023_xp_total_and_sync_run_pruning.sql /
 * 0025_lock_down_xp_total_and_prune_sync_runs_grants.sql) — run through the
 * service-role client here, same as the other admin actions on this page
 * that need to see or touch rows a plain client's RLS would otherwise hide.
 */
export async function pruneSyncRuns(): Promise<{ error: string | null; recordsProcessed?: number }> {
  const profile = await getOrCreateProfile();
  if (!profile || !canManageFootballData(profile.role)) {
    return { error: "You don't have football data admin access." };
  }

  const service = createServiceRoleSupabaseClient();
  const { data: deletedCount, error } = await service.rpc("prune_sync_runs", { p_older_than_days: 90 });

  if (error) {
    console.error("Failed to prune sync_runs", error);
    return { error: "Couldn't prune old sync runs. Try again." };
  }

  await logAudit(profile.id, "prune_sync_runs", "sync_runs", {
    olderThanDays: 90,
    recordsProcessed: deletedCount ?? 0,
  });

  revalidatePath("/admin/data-health");

  return { error: null, recordsProcessed: deletedCount ?? 0 };
}

/**
 * RECOMMENDATIONS.md item 51: FOOTBALL_LIVE_POLLING_ENABLED (src/lib/football/index.ts)
 * used to guard nothing. This is the real guard it now sits in front of — a manual,
 * admin-triggered "refresh live scores" action, never a timer/poll of any kind (the
 * flag's own doc comment: never let it default to true without a paid provider tier).
 *
 * There's no separate "just the live ones" provider endpoint (see
 * FootballDataProvider.getFixturesByDate in src/lib/football/types.ts) — this reuses
 * syncTodayFixtures exactly like the main "Sync now" button, since it's a single call
 * that already writes fresh status/score/minute for every fixture live right now. The
 * flag's purpose here is entirely about *when* this is allowed to run at all: with the
 * flag off (the default, and the only safe state on the free tier), the action returns
 * a clear message instead of spending quota, rather than silently no-op'ing or lying
 * about having refreshed anything.
 */
export async function triggerLiveScoresRefresh(): Promise<{ error: string | null; recordsProcessed?: number }> {
  const denied = await requireFootballDataAccess();
  if (denied) return denied;

  if (!FOOTBALL_LIVE_POLLING_ENABLED) {
    return {
      error:
        "Live score refreshes are disabled until a paid API-Football tier exists (FOOTBALL_LIVE_POLLING_ENABLED is off). Use \"Sync now\" on Data Health instead.",
    };
  }

  const result = await syncTodayFixtures();

  revalidatePath("/admin/data-health");
  revalidatePath("/live");
  revalidatePath("/matches");

  if (result.status === "failed") {
    return { error: result.error ?? "Live score refresh failed. See the sync_runs row for details." };
  }

  return { error: null, recordsProcessed: result.recordsProcessed };
}

/**
 * RECOMMENDATIONS.md item 64: resolveTeamId in src/lib/football/sync-transfers.ts
 * correctly leaves from_team_id/to_team_id null for a club KIVO hasn't synced yet,
 * but nothing ever revisited those rows once the club *did* get synced later — this
 * is that revisit. Pure DB work: reconcileUnresolvedTransferTeams() never calls the
 * provider (it only re-checks provider_mappings, now that more teams may exist there
 * than when the transfer was first synced), so this is safe to run as often as an
 * admin likes without touching the daily quota — no requireFootballDataAccess()
 * provider-configured guard needed for that reason, just the plain admin-role check.
 */
export async function reconcileTransferTeams(): Promise<{ error: string | null; recordsProcessed?: number }> {
  const profile = await getOrCreateProfile();
  if (!profile || !canManageFootballData(profile.role)) {
    return { error: "You don't have football data admin access." };
  }

  const result = await reconcileUnresolvedTransferTeams();

  if (result.error) {
    return { error: result.error };
  }

  await logAudit(profile.id, "reconcile_transfer_teams", "transfers", {
    recordsProcessed: result.recordsProcessed,
  });

  revalidatePath("/admin/data-health");
  revalidatePath("/transfers");

  return { error: null, recordsProcessed: result.recordsProcessed };
}
