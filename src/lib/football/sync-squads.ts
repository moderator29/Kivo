import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { getFootballDataProvider } from "./index";
import { createMapping, findMappedId } from "./provider-mappings";
import type { SyncResult } from "./sync";
import type { NormalizedManager, NormalizedPlayer } from "./types";
import { logError } from "@/lib/log";

type ServiceClient = SupabaseClient<Database>;

/**
 * Upserts a player by provider mapping. On an update, only fields the provider
 * actually supplied a non-null value for are touched — the free-tier squads
 * endpoint never returns dateOfBirth/nationality (see getSquad() in
 * providers/api-football.ts), and re-syncing must never clobber richer data a
 * future/paid source (or an admin) may have filled in with nulls. photoUrl
 * follows the same never-clobber-with-null rule (RECOMMENDATIONS.md item 56)
 * even though the free tier *does* return it on every call — a provider
 * response that briefly omits it for one player should never blank out a
 * photo already on file.
 */
async function upsertPlayer(
  supabase: ServiceClient,
  providerName: string,
  player: NormalizedPlayer,
  teamId: string,
): Promise<string> {
  const existing = await findMappedId(supabase, providerName, "player", player.providerId);

  if (existing) {
    const update: Database["public"]["Tables"]["players"]["Update"] = {
      full_name: player.fullName,
      current_team_id: teamId,
    };
    if (player.knownAs !== null) update.known_as = player.knownAs;
    if (player.dateOfBirth !== null) update.date_of_birth = player.dateOfBirth;
    if (player.nationality !== null) update.nationality = player.nationality;
    if (player.position !== null) update.position = player.position;
    if (player.photoUrl !== null) update.photo_url = player.photoUrl;

    const { error } = await supabase.from("players").update(update).eq("id", existing);
    if (error) throw error;
    return existing;
  }

  const { data, error } = await supabase
    .from("players")
    .insert({
      full_name: player.fullName,
      known_as: player.knownAs,
      date_of_birth: player.dateOfBirth,
      nationality: player.nationality,
      position: player.position,
      photo_url: player.photoUrl,
      current_team_id: teamId,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Failed to insert player");

  await createMapping(supabase, providerName, "player", player.providerId, data.id);
  return data.id;
}

/** Same "never clobber with a null" update rule as upsertPlayer above. */
async function upsertManager(
  supabase: ServiceClient,
  providerName: string,
  manager: NormalizedManager,
  teamId: string,
): Promise<string> {
  const existing = await findMappedId(supabase, providerName, "manager", manager.providerId);

  if (existing) {
    const update: Database["public"]["Tables"]["managers"]["Update"] = {
      full_name: manager.fullName,
      current_team_id: teamId,
    };
    if (manager.nationality !== null) update.nationality = manager.nationality;
    if (manager.dateOfBirth !== null) update.date_of_birth = manager.dateOfBirth;

    const { error } = await supabase.from("managers").update(update).eq("id", existing);
    if (error) throw error;
    return existing;
  }

  const { data, error } = await supabase
    .from("managers")
    .insert({
      full_name: manager.fullName,
      nationality: manager.nationality,
      date_of_birth: manager.dateOfBirth,
      current_team_id: teamId,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Failed to insert manager");

  await createMapping(supabase, providerName, "manager", manager.providerId, data.id);
  return data.id;
}

/**
 * On-demand, admin-triggered sync of one team's squad + current manager. Safely
 * callable per-team — never bulk-all-teams, which would blow the free-tier daily
 * quota in a handful of calls (see providers/api-football.ts cache comments).
 * Writes go through the service-role client, same RLS rationale as sync.ts.
 * A bad player never aborts the whole squad; per-player failures are caught,
 * logged and rolled into the run's error_message instead.
 */
export async function syncTeamSquad(teamId: string): Promise<SyncResult> {
  const supabase = createServiceRoleSupabaseClient();
  const provider = await getFootballDataProvider();

  const { data: syncRun, error: startError } = await supabase
    .from("sync_runs")
    .insert({ provider: provider.name, entity_type: "player", status: "running" })
    .select("id")
    .single();

  if (startError || !syncRun) {
    logError("football.sync-squads.startSquadSyncRun", startError);
    return {
      status: "failed",
      recordsProcessed: 0,
      error: startError?.message ?? "Could not create sync_runs row",
    };
  }

  const fail = async (message: string): Promise<SyncResult> => {
    await supabase
      .from("sync_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        records_processed: 0,
        error_message: message,
        // RECOMMENDATIONS.md item 53: real quota data even on a hard failure.
        provider_quota_remaining: provider.getQuotaRemaining(),
      })
      .eq("id", syncRun.id);
    return { status: "failed", recordsProcessed: 0, error: message };
  };

  const teamProviderId = await findMappedId(supabase, provider.name, "team", teamId);
  if (!teamProviderId) {
    return fail(
      `Team ${teamId} has no ${provider.name} provider mapping yet. Sync its competition's fixtures first.`,
    );
  }

  let squad: NormalizedPlayer[];
  try {
    squad = await provider.getSquad(teamProviderId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("football.sync-squads.squadSyncGetsquad", err);
    return fail(message);
  }

  let manager: NormalizedManager | null = null;
  const errors: string[] = [];
  try {
    manager = await provider.getManager(teamProviderId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("football.sync-squads.squadSyncGetmanagerContinuing", err);
    errors.push(`manager fetch: ${message}`);
  }

  let processed = 0;

  for (const player of squad) {
    try {
      await upsertPlayer(supabase, provider.name, player, teamId);
      processed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError("football.sync-squads.squadSyncUpsertPlayer", err, { detail: `Squad sync: failed to upsert player ${provider.name}:${player.providerId}` });
      errors.push(`player ${provider.name}:${player.providerId} (${player.fullName}): ${message}`);
    }
  }

  if (manager) {
    try {
      await upsertManager(supabase, provider.name, manager, teamId);
      processed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError("football.sync-squads.squadSyncUpsertManager", err, { detail: `Squad sync: failed to upsert manager ${provider.name}:${manager.providerId}` });
      errors.push(`manager ${provider.name}:${manager.providerId} (${manager.fullName}): ${message}`);
    }
  }

  const finishedAt = new Date().toISOString();
  const hadWork = squad.length > 0 || manager !== null;
  const dbStatus: Database["public"]["Enums"]["sync_status"] =
    errors.length === 0 ? "success" : hadWork && processed === 0 ? "failed" : "partial";
  const errorMessage = errors.length > 0 ? errors.slice(0, 20).join("; ") : null;

  await supabase
    .from("sync_runs")
    .update({
      status: dbStatus,
      finished_at: finishedAt,
      last_synced_at: finishedAt,
      records_processed: processed,
      error_message: errorMessage,
      // RECOMMENDATIONS.md item 53: the provider's own remaining-quota count,
      // not an estimate — see ApiFootballProvider.getQuotaRemaining().
      provider_quota_remaining: provider.getQuotaRemaining(),
    })
    .eq("id", syncRun.id);

  return {
    status: dbStatus === "failed" ? "failed" : "succeeded",
    recordsProcessed: processed,
    error: errorMessage ?? undefined,
  };
}
