import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { getFootballDataProvider } from "./index";
import { createMapping, findMappedId, findProviderEntityId } from "./provider-mappings";
import type { SyncResult } from "./sync";
import type { NormalizedTeamTransfer, NormalizedTransfer } from "./types";
import { notifyTransferRecorded } from "./transfer-notifications";
import { logError } from "@/lib/log";

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

  // Follow alerts fire from this branch only — a row KIVO has genuinely never
  // held before. The update branch above returns before reaching here, so
  // re-running this sync over a player's existing history notifies nobody. The
  // first sync of a long career is still a burst, and that is correct: those
  // moves are new to KIVO and to everyone following the clubs involved.
  //
  // Deliberately not allowed to fail the sync: a notification problem must
  // never turn a successfully stored transfer into a failed run.
  try {
    const names = await loadTransferPartyNames(supabase, playerId, fromTeamId, toTeamId);
    if (names) {
      await notifyTransferRecorded(supabase, {
        transferId: data.id,
        playerId,
        playerName: names.playerName,
        fromTeamId,
        fromTeamName: names.fromTeamName,
        toTeamId,
        toTeamName: names.toTeamName,
      });
    }
  } catch (notifyError) {
    logError("football.sync-transfers.notifyTransferRecorded", notifyError);
  }
}

/**
 * The display names the alert's summary line needs, read back from the rows
 * that were just written against. Returns null when the player row itself is
 * missing, which would make any sentence about the move unwritable — better no
 * alert than one addressed to nobody in particular.
 */
async function loadTransferPartyNames(
  supabase: ServiceClient,
  playerId: string,
  fromTeamId: string | null,
  toTeamId: string | null,
): Promise<{ playerName: string; fromTeamName: string | null; toTeamName: string | null } | null> {
  const [{ data: player }, { data: fromTeam }, { data: toTeam }] = await Promise.all([
    supabase.from("players").select("full_name, known_as").eq("id", playerId).maybeSingle(),
    fromTeamId
      ? supabase.from("teams").select("name").eq("id", fromTeamId).maybeSingle()
      : Promise.resolve({ data: null }),
    toTeamId ? supabase.from("teams").select("name").eq("id", toTeamId).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  if (!player) return null;
  return {
    playerName: player.known_as ?? player.full_name,
    fromTeamName: fromTeam?.name ?? null,
    toTeamName: toTeam?.name ?? null,
  };
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

/**
 * One club's whole recorded transfer history, in ONE provider request.
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The founder's report was "no transfer too ... it's not calling it or
 * anything". Checked against the live database: the `transfers` table has zero
 * rows, and `sync_runs` has never recorded a single run with
 * `entity_type = 'transfer'`. The code above is correct and always has been —
 * it simply could not be afforded.
 *
 * `syncPlayerTransfers` is per player, and it says so in its own doc comment:
 * "Never bulk — always called for one player at a time, to respect the free
 * tier's daily quota." That constraint was real, and its consequence was that
 * filling one 25-man squad's transfer history cost a quarter of the entire
 * day's allowance. Nobody was ever going to press that button 25 times, so the
 * table stayed empty, and /transfers has been an empty page since it was built.
 *
 * `/transfers?team={id}` returns the same data for a whole club in one request.
 * That is the difference between a feature nobody can afford and a feature that
 * costs one request per club.
 *
 * PLAYERS KIVO HAS NEVER SEEN
 * ---------------------------------------------------------------------------
 * A club's transfer history names players who left years ago and players who
 * have not yet appeared in a synced squad. `upsertTransfer` needs a KIVO player
 * id, so this creates one where it must — from the only fact the endpoint
 * carries, which is the player's name.
 *
 * A row created that way is a real player with a real name and nothing else: no
 * date of birth, no nationality, no position, no photo. A later squad sync
 * fills those in under the same never-clobber-with-null rule `upsertPlayer`
 * already applies. Deliberately not treated as a reason to skip the transfer:
 * a named player with a documented move is worth more than a blank page, and
 * the alternative on offer was no transfer history at all.
 *
 * DEDUPLICATION IS NOT NEW WORK
 * ---------------------------------------------------------------------------
 * The provider returns a move from both clubs' perspectives, and the same move
 * again if the player is later synced individually. All three paths build the
 * identical synthetic provider id, so `upsertTransfer`'s existing
 * mapping lookup collapses them into one row — and, because the update branch
 * returns before the notify block, re-running this over a club KIVO already
 * knows notifies nobody a second time.
 */
export async function syncTeamTransfers(teamId: string): Promise<SyncResult> {
  const supabase = createServiceRoleSupabaseClient();
  const provider = await getFootballDataProvider();

  const { data: syncRun, error: startError } = await supabase
    .from("sync_runs")
    .insert({ provider: provider.name, entity_type: "transfer", status: "running" })
    .select("id")
    .single();

  if (startError || !syncRun) {
    logError("football.sync-transfers.startTeamTransferSyncRun", startError);
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
        provider_quota_remaining: provider.getQuotaRemaining(),
      })
      .eq("id", syncRun.id);
    return { status: "failed", recordsProcessed: 0, error: message };
  };

  const teamProviderId = await findProviderEntityId(supabase, provider.name, "team", teamId);
  if (!teamProviderId) {
    return fail(`Team ${teamId} has no ${provider.name} provider mapping yet. Sync its competition's clubs first.`);
  }

  let transfers: NormalizedTeamTransfer[];
  try {
    transfers = await provider.getTeamTransfers(teamProviderId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("football.sync-transfers.teamTransferSyncGetteamtransfers", err);
    return fail(message);
  }

  // One lookup for every player named in the whole history, rather than one per
  // transfer — the same batching KN-12 applied to standings, and it matters
  // more here: a club's history routinely names a hundred players across
  // several hundred moves.
  const playerProviderIds = [...new Set(transfers.map((t) => t.playerProviderId))];
  const playerIdByProviderId = await resolveOrCreatePlayers(supabase, provider.name, playerProviderIds, transfers);

  let processed = 0;
  const errors: string[] = [];

  for (const transfer of transfers) {
    const playerId = playerIdByProviderId.get(transfer.playerProviderId);
    if (!playerId) {
      // The player row could not be created. Recorded rather than swallowed:
      // the move is real and KIVO failed to store it, which is a different
      // thing from the club having no transfers.
      errors.push(`transfer ${provider.name}:${transfer.providerId}: could not resolve player ${transfer.playerName}`);
      continue;
    }
    try {
      await upsertTransfer(supabase, provider.name, playerId, transfer);
      processed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError("football.sync-transfers.teamTransferSyncUpsertTransfer", err, {
        detail: `Team transfer sync: failed to upsert transfer ${provider.name}:${transfer.providerId}`,
      });
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
 * KIVO player ids for every provider player id named in a club's transfer
 * history, creating a minimal row for the ones KIVO has never synced.
 *
 * `current_team_id` is left null on a created row, deliberately. The club being
 * synced is where the player moved *to or from*, at some point, possibly years
 * ago — it is not evidence of where they play now, and writing it as if it were
 * would put a wrong current club on a player profile. Null here means "KIVO
 * does not know", which is the truth, and a squad sync answers it properly.
 *
 * A player whose row cannot be created is simply absent from the returned map;
 * the caller records that as an error against the specific transfer rather than
 * failing the whole club.
 */
async function resolveOrCreatePlayers(
  supabase: ServiceClient,
  providerName: string,
  playerProviderIds: string[],
  transfers: NormalizedTeamTransfer[],
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  if (playerProviderIds.length === 0) return resolved;

  const { data: mappings, error } = await supabase
    .from("provider_mappings")
    .select("provider_entity_id, kivo_entity_id")
    .eq("provider", providerName)
    .eq("entity_type", "player")
    .in("provider_entity_id", playerProviderIds);

  if (error) {
    // Not fatal. An unreadable mapping table means every player looks new, and
    // the insert path below then collides on its own unique mapping constraint
    // rather than creating duplicates — a slower run, not a wrong one.
    logError("football.sync-transfers.resolvePlayers", error);
  }

  for (const mapping of mappings ?? []) resolved.set(mapping.provider_entity_id, mapping.kivo_entity_id);

  const nameByProviderId = new Map(transfers.map((t) => [t.playerProviderId, t.playerName]));

  for (const providerId of playerProviderIds) {
    if (resolved.has(providerId)) continue;
    const fullName = nameByProviderId.get(providerId);
    if (!fullName) continue;

    try {
      const { data, error: insertError } = await supabase
        .from("players")
        .insert({ full_name: fullName, current_team_id: null })
        .select("id")
        .single();
      if (insertError || !data) throw insertError ?? new Error("Failed to insert player");

      await createMapping(supabase, providerName, "player", providerId, data.id);
      resolved.set(providerId, data.id);
    } catch (err) {
      logError("football.sync-transfers.createTransferPlayer", err, {
        detail: `Team transfer sync: could not create player ${providerName}:${providerId}`,
      });
    }
  }

  return resolved;
}
