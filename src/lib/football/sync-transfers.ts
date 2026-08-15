import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { getFootballDataProvider } from "./index";
import type { SyncResult } from "./sync";
import type { NormalizedTransfer } from "./types";

type ServiceClient = SupabaseClient<Database>;
type EntityType = Database["public"]["Enums"]["provider_entity_type"];

// Deliberately duplicated from sync.ts — see the doc comment at the top of
// sync-squads.ts for why these small helpers live here again instead of being
// imported from (or added to) the already-reviewed sync.ts.
async function findMappedId(
  supabase: ServiceClient,
  provider: string,
  entityType: EntityType,
  providerEntityId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("provider_mappings")
    .select("kivo_entity_id")
    .eq("provider", provider)
    .eq("entity_type", entityType)
    .eq("provider_entity_id", providerEntityId)
    .maybeSingle();

  if (error) throw error;
  return data?.kivo_entity_id ?? null;
}

/** Reverse of findMappedId — given a KIVO id, find the provider's own id for it.
 * Needed here (unlike sync.ts) because the caller passes in a KIVO player id and
 * this file has to go the other direction to call the provider API. Same pattern
 * as findProviderEntityId in sync-match-details.ts. */
async function findProviderEntityId(
  supabase: ServiceClient,
  provider: string,
  entityType: EntityType,
  kivoEntityId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("provider_mappings")
    .select("provider_entity_id")
    .eq("provider", provider)
    .eq("entity_type", entityType)
    .eq("kivo_entity_id", kivoEntityId)
    .maybeSingle();

  if (error) throw error;
  return data?.provider_entity_id ?? null;
}

async function createMapping(
  supabase: ServiceClient,
  provider: string,
  entityType: EntityType,
  providerEntityId: string,
  kivoEntityId: string,
): Promise<void> {
  const { error } = await supabase
    .from("provider_mappings")
    .insert({ provider, entity_type: entityType, provider_entity_id: providerEntityId, kivo_entity_id: kivoEntityId });
  // 23505 = another concurrent sync already created this mapping — fine, it points
  // at the same kivo entity either way.
  if (error && error.code !== "23505") throw error;
}

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

  const payload: Database["public"]["Tables"]["transfers"]["Insert"] = {
    player_id: playerId,
    from_team_id: fromTeamId,
    to_team_id: toTeamId,
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
  const provider = getFootballDataProvider();

  const { data: syncRun, error: startError } = await supabase
    .from("sync_runs")
    .insert({ provider: provider.name, entity_type: "transfer", status: "running" })
    .select("id")
    .single();

  if (startError || !syncRun) {
    console.error("Failed to start transfer sync run", startError);
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
    console.error("Transfer sync: getPlayerTransfers failed", err);
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
      console.error(`Transfer sync: failed to upsert transfer ${provider.name}:${transfer.providerId}`, err);
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
    })
    .eq("id", syncRun.id);

  return {
    status: dbStatus === "failed" ? "failed" : "succeeded",
    recordsProcessed: processed,
    error: errorMessage ?? undefined,
  };
}
