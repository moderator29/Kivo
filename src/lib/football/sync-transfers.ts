import { logError } from "@/lib/log";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { getFootballDataProvider } from "./index";
import { createMapping, findMappedId, findProviderEntityId } from "./provider-mappings";
import type { SyncResult } from "./sync";
import type { NormalizedTransfer } from "./types";

type ServiceClient = SupabaseClient<Database>;

/**
 * Resolves a transfer's team side to a KIVO team id. Both sides are optional per
 * NormalizedTransfer (a move can originate/land outside KIVO's synced teams) —
 * returns null (never throws, never fabricates a team) when either the provider
 * didn't report a team id for this side, or that team has no KIVO mapping yet.
 * The latter is expected and not logged as an error: only fixture/squad syncs
 * create team mappings, and a transfer can easily reference a club KIVO has
 * never seen a fixture for.
 */
async function resolveTeamId(
  supabase: ServiceClient,
  providerName: string,
  teamProviderId: string | null,
): Promise<string | null> {
  if (!teamProviderId) return null;
  return findMappedId(supabase, providerName, "team", teamProviderId);
}

async function upsertTransfer(
  supabase: ServiceClient,
  providerName: string,
  playerId: string,
  transfer: NormalizedTransfer,
): Promise<void> {
  const [fromTeamId, toTeamId] = await Promise.all([
    resolveTeamId(supabase, providerName, transfer.fromTeamProviderId),
    resolveTeamId(supabase, providerName, transfer.toTeamProviderId),
  ]);

  // from_team_provider_id/to_team_provider_id (migration 0030, RECOMMENDATIONS.md
  // item 64) are always written, resolved or not — persisting the provider's raw id
  // even when resolveTeamId came back null is exactly what lets
  // reconcileUnresolvedTransferTeams() below re-resolve this row later, once that
  // club has been synced, without spending fresh provider quota to re-fetch it.
  const payload: Database["public"]["Tables"]["transfers"]["Insert"] = {
    player_id: playerId,
    from_team_id: fromTeamId,
    from_team_provider_id: transfer.fromTeamProviderId,
    to_team_id: toTeamId,
    to_team_provider_id: transfer.toTeamProviderId,
    transfer_date: transfer.transferDate,
    fee_text: transfer.feeText,
    transfer_type: transfer.transferType,
  };

  const existingId = await findMappedId(supabase, providerName, "transfer", transfer.providerId);
  if (existingId) {
    const { error } = await supabase.from("transfers").update(payload).eq("id", existingId);
    if (error) throw error;
    return;
  }

  const { data, error } = await supabase.from("transfers").insert(payload).select("id").single();
  if (error || !data) throw error ?? new Error("Failed to insert transfer");

  await createMapping(supabase, providerName, "transfer", transfer.providerId, data.id);
}

/**
 * On-demand, admin-triggered sync of one player's full transfer history. Only
 * meaningful once the player already has a provider_mappings entry (created by
 * a prior squad sync) — fails gracefully with a clear message otherwise, same
 * "resolve KIVO id -> provider id" pattern as syncFixtureDetails/syncStandings
 * in sync-match-details.ts. Never bulk — always called for one player at a time,
 * to respect the free tier's daily quota (see providers/api-football.ts).
 */
export async function syncPlayerTransfers(playerId: string): Promise<SyncResult> {
  const supabase = createServiceRoleSupabaseClient();
  const provider = await getFootballDataProvider();

  const { data: syncRun, error: startError } = await supabase
    .from("sync_runs")
    .insert({ provider: provider.name, entity_type: "transfer", status: "running" })
    .select("id")
    .single();

  if (startError || !syncRun) {
    logError("football.sync-transfers.startTransferSyncRun", startError);
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

  const playerProviderId = await findProviderEntityId(supabase, provider.name, "player", playerId);
  if (!playerProviderId) {
    return fail(
      `Player ${playerId} has no ${provider.name} provider mapping yet. Sync its team's squad first.`,
    );
  }

  let transfers: NormalizedTransfer[];
  try {
    transfers = await provider.getPlayerTransfers(playerProviderId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("football.sync-transfers.transferSyncGetplayertransfers", err);
    return fail(message);
  }

  let processed = 0;
  const errors: string[] = [];

  for (const transfer of transfers) {
    try {
      await upsertTransfer(supabase, provider.name, playerId, transfer);
      processed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError("football.sync-transfers.transferSyncUpsertTransfer", err, { detail: `Transfer sync: failed to upsert transfer ${provider.name}:${transfer.providerId}` });
      errors.push(`transfer ${provider.name}:${transfer.providerId} (${transfer.transferDate}): ${message}`);
    }
  }

  const finishedAt = new Date().toISOString();
  const hadTransfers = transfers.length > 0;
  const dbStatus: Database["public"]["Enums"]["sync_status"] =
    errors.length === 0 ? "success" : hadTransfers && processed === 0 ? "failed" : "partial";
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

/**
 * RECOMMENDATIONS.md item 64: resolveTeamId above correctly leaves a transfer's
 * from_team_id/to_team_id null when it references a club KIVO hasn't synced yet —
 * but nothing ever revisited those rows once the club *did* get synced later
 * (via a subsequent fixture or squad sync), so "Club not synced" on /transfers
 * and every player's transfer history was effectively permanent.
 *
 * This is a pure DB reconciliation pass: it scans for transfers rows the earlier
 * sync left with a provider id recorded but no KIVO id (from_team_provider_id/
 * to_team_provider_id, migration 0030), re-runs findMappedId against
 * provider_mappings — now possibly populated by a later sync — and fills in
 * whichever side just resolved. Zero provider calls, so it costs nothing against
 * the daily quota and is safe to run as often as an admin likes.
 *
 * Capped at 500 rows per run (bounded work per click, same spirit as the 20-error
 * cap on sync_runs.error_message elsewhere in this file) — an admin can just run it
 * again if more remain, same on-demand pattern as every other sync action.
 */
const RECONCILE_BATCH_LIMIT = 500;

export async function reconcileUnresolvedTransferTeams(): Promise<{ error: string | null; recordsProcessed: number }> {
  const supabase = createServiceRoleSupabaseClient();

  // getFootballDataProvider() never makes a network call on its own (constructing
  // ApiFootballProvider just sets `name` and stores the key) — only used here for
  // `provider.name`, the string provider_mappings rows are keyed on. Still guarded:
  // it throws when no provider is configured at all, which this action (deliberately
  // not gated on API_FOOTBALL_KEY, see triggerLiveScoresRefresh's sibling comment in
  // actions.ts) should report as a clear message rather than an unhandled crash.
  let providerName: string;
  try {
    providerName = (await getFootballDataProvider()).name;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message, recordsProcessed: 0 };
  }

  const { data: rows, error: selectError } = await supabase
    .from("transfers")
    .select("id, from_team_id, from_team_provider_id, to_team_id, to_team_provider_id")
    .or("and(from_team_id.is.null,from_team_provider_id.not.is.null),and(to_team_id.is.null,to_team_provider_id.not.is.null)")
    .limit(RECONCILE_BATCH_LIMIT);

  if (selectError) {
    logError("football.sync-transfers.transferTeamReconciliationLoad", selectError);
    return { error: "Couldn't load unresolved transfers. Try again.", recordsProcessed: 0 };
  }
  if (!rows || rows.length === 0) {
    return { error: null, recordsProcessed: 0 };
  }

  let resolvedCount = 0;
  for (const row of rows) {
    const update: Database["public"]["Tables"]["transfers"]["Update"] = {};

    if (row.from_team_id === null && row.from_team_provider_id !== null) {
      const resolved = await resolveTeamId(supabase, providerName, row.from_team_provider_id);
      if (resolved) update.from_team_id = resolved;
    }
    if (row.to_team_id === null && row.to_team_provider_id !== null) {
      const resolved = await resolveTeamId(supabase, providerName, row.to_team_provider_id);
      if (resolved) update.to_team_id = resolved;
    }

    if (Object.keys(update).length === 0) continue;

    const { error: updateError } = await supabase.from("transfers").update(update).eq("id", row.id);
    if (updateError) {
      logError("football.sync-transfers.transferTeamReconciliationUpdate", updateError, { detail: `Transfer team reconciliation: failed to update transfer ${row.id}` });
      continue;
    }
    resolvedCount += 1;
  }

  return { error: null, recordsProcessed: resolvedCount };
}
