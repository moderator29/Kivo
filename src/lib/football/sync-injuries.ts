import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { getFootballDataProvider } from "./index";
import { batchFindMappedIds, createMapping, findMappedId, findProviderEntityId } from "./provider-mappings";
import { shouldAttemptCapability } from "./coverage-registry";
import { SyncRunRecorder } from "./sync-run-recorder";
import { resolveSeasonYear } from "./target-season";
import type { SyncResult } from "./sync";
import type { NormalizedInjury } from "./types";
import { logError } from "@/lib/log";

type ServiceClient = SupabaseClient<Database>;

/**
 * Injuries (`injuries`, migration 0083).
 *
 * ## The claim being made, and why it is handled more carefully than a score
 *
 * Every row here is a statement about a named person's body. Getting a score
 * wrong is embarrassing; telling three million people a fit player is ruled out
 * is a different category of wrong. So:
 *
 *   * an unparseable provider status becomes `'unknown'`, never `'out'`
 *     (`mapInjuryStatus`);
 *   * the reason is the provider's own words, verbatim, never bucketed;
 *   * there is no expected-return column anywhere, because the provider
 *     publishes none and it is the single most tempting field to estimate;
 *   * a report whose player KIVO cannot resolve is skipped and logged rather
 *     than attached to a best-guess player.
 *
 * ## Is this endpoint even available?
 *
 * `docs/API_FOOTBALL.md` records injuries as unavailable on the free tier, and
 * this build cannot reach api-football.com to re-check. That is not resolved by
 * guessing — it is resolved by the coverage registry, which is the provider's
 * own per-competition statement about exactly this. The guard below skips only
 * on a definite "unsupported"; an unknown registry attempts once and lets the
 * response be the evidence.
 */
async function upsertInjury(
  supabase: ServiceClient,
  providerName: string,
  playerId: string,
  context: { competitionId: string; seasonId: string | null },
  injury: NormalizedInjury,
  teamMappings: Map<string, string>,
  fixtureMappings: Map<string, string>,
): Promise<void> {
  const payload: Database["public"]["Tables"]["injuries"]["Insert"] = {
    player_id: playerId,
    team_id: injury.teamProviderId ? (teamMappings.get(injury.teamProviderId) ?? null) : null,
    fixture_id: injury.fixtureProviderId ? (fixtureMappings.get(injury.fixtureProviderId) ?? null) : null,
    competition_id: context.competitionId,
    season_id: context.seasonId,
    status: injury.status,
    reason: injury.reason,
    reported_on: injury.reportedOn,
    provider: providerName,
  };

  // Deduped through provider_mappings on the synthetic key the adapter derives,
  // exactly like transfers and fixture events — the endpoint publishes no stable
  // per-row id, and a re-sync must update the same report rather than append a
  // second copy of it.
  const existingId = await findMappedId(supabase, providerName, "injury", injury.providerId);
  if (existingId) {
    const { error } = await supabase.from("injuries").update(payload).eq("id", existingId);
    if (error) throw error;
    return;
  }

  const { data, error } = await supabase.from("injuries").insert(payload).select("id").single();
  if (error || !data) throw error ?? new Error("Failed to insert injury");
  await createMapping(supabase, providerName, "injury", injury.providerId, data.id);
}

/**
 * Syncs one competition's current injury list for one season.
 *
 * One provider request per competition, so it is called per competition and
 * never in a loop over every competition KIVO holds — that would be a dozen
 * requests out of a hundred, for a surface nobody has opened.
 */
export async function syncCompetitionInjuries(competitionId: string, season?: number): Promise<SyncResult> {
  const supabase = createServiceRoleSupabaseClient();
  const provider = await getFootballDataProvider();
  // The operator's target season, not the calendar's. Season-scoped
  // endpoints are refused outright by a free API-Football plan asked for the
  // current year — see target-season.ts for the provider's own wording.
  const seasonYear = await resolveSeasonYear(supabase, provider.name, season);

  const recorder = await SyncRunRecorder.start(supabase, provider, "injury");
  if (!recorder) {
    return { status: "failed", recordsProcessed: 0, error: "Could not create sync_runs row" };
  }

  const competitionProviderId = await findProviderEntityId(supabase, provider.name, "competition", competitionId);
  if (!competitionProviderId) {
    return recorder.finish("failed", 0, [
      `Competition ${competitionId} has no ${provider.name} mapping yet. Sync its fixtures first.`,
    ]);
  }

  const { attempt, verdict } = await shouldAttemptCapability(
    supabase,
    provider.name,
    competitionId,
    "injuries",
    seasonYear,
  );
  if (!attempt) {
    // Recorded as `skipped`, with the reason, so Data Health shows a decision
    // rather than a silence — and so nobody spends tomorrow's quota rediscovering
    // the same permanent no.
    return recorder.finish("skipped", 0, [
      `${provider.name} declares no injury coverage for this competition in ${seasonYear}. No request was made.`,
    ]);
  }

  let injuries: NormalizedInjury[];
  try {
    injuries = await provider.getInjuries(competitionProviderId, seasonYear);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("football.sync-injuries.fetch", err, { competitionId, season: seasonYear });
    return recorder.finish("failed", 0, [message]);
  }

  if (injuries.length === 0) {
    // Genuinely empty, and genuinely different from "unsupported": the provider
    // answered, and the answer was that nobody is reported unavailable.
    //
    // How much that empty answer is worth depends on what the registry said
    // beforehand, so it is recorded. "supported" plus empty is a real, usable
    // fact — KIVO can show "no reported absences" and mean it. "unknown" plus
    // empty could equally be a plan that returns nothing for this endpoint, and
    // an admin reading this run needs to be able to tell those apart.
    const note =
      verdict === "supported"
        ? "Provider reports no current absences for this competition."
        : "Provider returned no absences, and its coverage for this competition is unstated — an empty result here is not yet evidence that there are none.";
    return recorder.finish("success", 0, verdict === "supported" ? [] : [note]);
  }

  // Every id this run will reference, resolved up front — the same batching
  // KN-12 introduced for match details, for the same reason.
  const [teamMappings, fixtureMappings, playerMappings] = await Promise.all([
    batchFindMappedIds(
      supabase,
      provider.name,
      "team",
      injuries.map((i) => i.teamProviderId).filter((id): id is string => id !== null),
    ),
    batchFindMappedIds(
      supabase,
      provider.name,
      "fixture",
      injuries.map((i) => i.fixtureProviderId).filter((id): id is string => id !== null),
    ),
    batchFindMappedIds(
      supabase,
      provider.name,
      "player",
      injuries.map((i) => i.playerProviderId),
    ),
  ]);

  const { data: seasonRow } = await supabase
    .from("seasons")
    .select("id")
    .eq("competition_id", competitionId)
    .eq("provider_year", seasonYear)
    .maybeSingle();

  let processed = 0;
  const errors: string[] = [];

  for (const injury of injuries) {
    const playerId = playerMappings.get(injury.playerProviderId);
    if (!playerId) {
      // Expected rather than exceptional: an injury list covers squads KIVO has
      // never synced. Logged into the run's failure list so an admin can see the
      // shortfall, not thrown.
      errors.push(`player ${provider.name}:${injury.playerProviderId} (${injury.playerName}) is not in KIVO yet`);
      continue;
    }
    try {
      await upsertInjury(
        supabase,
        provider.name,
        playerId,
        { competitionId, seasonId: seasonRow?.id ?? null },
        injury,
        teamMappings,
        fixtureMappings,
      );
      processed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError("football.sync-injuries.upsert", err, { detail: `injury ${injury.providerId}` });
      errors.push(`injury ${injury.providerId}: ${message}`);
    }
  }

  return recorder.finish(SyncRunRecorder.verdict(processed, errors.length, injuries.length > 0), processed, errors);
}
