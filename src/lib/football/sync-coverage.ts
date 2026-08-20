import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { getFootballDataProvider } from "./index";
import { findMappedId } from "./provider-mappings";
import type { SyncResult } from "./sync";
import type { NormalizedCompetitionCoverage } from "./types";
import { resolveSeasonYear } from "./target-season";
import { recordUnstartableRun } from "./sync-run-recorder";
import { logError } from "@/lib/log";

type ServiceClient = SupabaseClient<Database>;

/**
 * The coverage registry's sync (`provider_coverage`, migration 0082).
 *
 * ## Why this is the highest-value request on the whole API
 *
 * Every other endpoint returns data. This one returns a CAPABILITY: the
 * provider's own statement, per competition per season, of which of its
 * endpoints will ever return anything. It is the only thing that lets KIVO tell
 * a user "this competition does not publish lineups" instead of "nothing synced
 * yet" — and those two sentences ask the reader to do completely different
 * things. One says wait; the other says stop waiting.
 *
 * ## What it costs
 *
 * One request. Not one per competition — one, total, for every competition the
 * plan can see. On a 100-requests-a-day budget that is the best ratio of
 * usefulness to spend available anywhere on this API, and it is why the
 * provider caches it for a week (COVERAGE_CACHE_SECONDS) rather than hours.
 *
 * ## Rows are kept for competitions KIVO has never synced
 *
 * The response covers far more competitions than KIVO holds. Those rows are
 * stored anyway, with `competition_id` null and the provider's own id kept, so
 * that the day a competition IS synced its coverage is already known and costs
 * nothing to learn. `reconcileCoverageCompetitions` fills the foreign key in
 * afterwards with zero provider calls — the same pattern
 * `reconcileUnresolvedTransferTeams` already established for clubs.
 */

/**
 * Re-exported, not defined here any more.
 *
 * The calendar season used to be the only answer to "which season?". It is now
 * the LAST of three (`target-season.ts`): an operator's `provider_season_target`
 * row wins, then `FOOTBALL_TARGET_SEASON`, then this. That chain exists because
 * a free API-Football plan refuses every season-scoped endpoint for the current
 * season — see `target-season.ts` for the provider's own recorded wording.
 *
 * Kept exported from this module so nothing that already imported it breaks;
 * new callers should prefer `resolveSeasonYear`, which consults the whole chain.
 */
export { currentProviderSeason } from "./target-season";

async function upsertCoverageRow(
  supabase: ServiceClient,
  providerName: string,
  row: NormalizedCompetitionCoverage,
): Promise<void> {
  // Resolved when KIVO already holds this competition, null when it does not.
  // Null is not a failure and is never logged as one: most of a /leagues
  // response is competitions KIVO has deliberately never synced.
  const competitionId = await findMappedId(supabase, providerName, "competition", row.competitionProviderId);

  const payload: Database["public"]["Tables"]["provider_coverage"]["Insert"] = {
    provider: providerName,
    provider_competition_id: row.competitionProviderId,
    season_year: row.season,
    competition_id: competitionId,
    competition_name: row.competitionName,
    // The country/type/badge the same `/leagues` response already carried and
    // KIVO used to discard (migration 0107). This makes the registry the only
    // place KIVO can learn what a league id IS — its name and where it is
    // played — without first spending a request on it, which is what lets the
    // competition allowlist be verified against the provider rather than taken
    // on faith, and what fills the country on every competition whose row was
    // created by a fixture sync that never had one.
    country: row.competitionCountry,
    competition_type: row.competitionType,
    logo_url: row.competitionLogoUrl,
    fixture_events: row.fixtureEvents,
    fixture_lineups: row.fixtureLineups,
    fixture_statistics: row.fixtureStatistics,
    fixture_player_statistics: row.fixturePlayerStatistics,
    standings: row.standings,
    players: row.players,
    top_scorers: row.topScorers,
    top_assists: row.topAssists,
    top_cards: row.topCards,
    injuries: row.injuries,
    predictions: row.predictions,
    odds: row.odds,
    raw: (row.raw ?? null) as Database["public"]["Tables"]["provider_coverage"]["Insert"]["raw"],
    retrieved_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("provider_coverage")
    .upsert(payload, { onConflict: "provider,provider_competition_id,season_year" });
  if (error) throw error;
}

/**
 * Refreshes the whole registry for one season.
 *
 * Deliberately all-or-nothing per row rather than per response: one competition
 * failing to write must not lose the other four hundred, so each row is caught
 * individually and the run reports `partial`.
 */
export async function syncProviderCoverage(season?: number): Promise<SyncResult> {
  const supabase = createServiceRoleSupabaseClient();

  /**
   * Wrapped, not awaited bare.
   *
   * `provider_coverage` and `sync_runs.entity_type = 'coverage'` are BOTH zero
   * on the live database, and those two zeroes together are what made this
   * unreadable: the run row below is opened before the provider is ever called,
   * so a plan refusal — the expected failure here, since `/leagues?season=` is
   * season-scoped — would have left a `failed` coverage row behind. None
   * exists. The only remaining way to press this and leave nothing at all is a
   * throw from this line, and until now that throw escaped the function
   * entirely: no row inserted, no row updated, the server action rejected, and
   * the Admin button stopped spinning without a word. See
   * `recordUnstartableRun`.
   */
  let provider;
  try {
    provider = await getFootballDataProvider();
  } catch (err) {
    return recordUnstartableRun(
      supabase,
      "coverage",
      `The coverage registry refresh could not start: ${err instanceof Error ? err.message : String(err)}`,
      "manual",
    );
  }

  // The operator's target season, not the calendar's — `/leagues?season=` is
  // season-scoped and is refused outright by a free plan asked for the current
  // year, which is why this registry has never once been filled on the live
  // database. See target-season.ts.
  const seasonYear = await resolveSeasonYear(supabase, provider.name, season);

  const { data: syncRun, error: startError } = await supabase
    .from("sync_runs")
    .insert({ provider: provider.name, entity_type: "coverage", status: "running", trigger_source: "manual" })
    .select("id")
    .single();

  if (startError || !syncRun) {
    logError("football.sync-coverage.startRun", startError);
    return { status: "failed", recordsProcessed: 0, error: startError?.message ?? "Could not create sync_runs row" };
  }

  const finish = async (
    status: Database["public"]["Enums"]["sync_status"],
    processed: number,
    errorMessage: string | null,
  ): Promise<SyncResult> => {
    const finishedAt = new Date().toISOString();
    await supabase
      .from("sync_runs")
      .update({
        status,
        finished_at: finishedAt,
        last_synced_at: status === "failed" ? null : finishedAt,
        records_processed: processed,
        error_message: errorMessage,
        provider_quota_remaining: provider.getQuotaRemaining(),
      })
      .eq("id", syncRun.id);
    return {
      status: status === "failed" ? "failed" : "succeeded",
      recordsProcessed: processed,
      error: errorMessage ?? undefined,
    };
  };

  let rows: NormalizedCompetitionCoverage[];
  try {
    rows = await provider.getCompetitionCoverage(seasonYear);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("football.sync-coverage.fetch", err, { season: seasonYear });
    return finish("failed", 0, message);
  }

  if (rows.length === 0) {
    // A provider that publishes no capability declaration (TheSportsDB) lands
    // here. Recorded as `skipped` rather than `success`: nothing was learned,
    // and a success row would make Data Health claim the registry is populated.
    return finish("skipped", 0, `${provider.name} publishes no coverage declaration for season ${seasonYear}.`);
  }

  let processed = 0;
  const errors: string[] = [];
  for (const row of rows) {
    try {
      await upsertCoverageRow(supabase, provider.name, row);
      processed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError("football.sync-coverage.upsert", err, { detail: `competition ${row.competitionProviderId}` });
      errors.push(`competition ${row.competitionProviderId} (${row.competitionName}): ${message}`);
    }
  }

  const status: Database["public"]["Enums"]["sync_status"] =
    errors.length === 0 ? "success" : processed === 0 ? "failed" : "partial";
  return finish(status, processed, errors.length > 0 ? errors.slice(0, 20).join("; ") : null);
}

/**
 * Fills in `competition_id` on coverage rows whose competition has since been
 * synced into KIVO.
 *
 * Zero provider calls, so it costs nothing against the daily quota and is safe
 * to run as often as an admin likes — identical in shape and rationale to
 * `reconcileUnresolvedTransferTeams`. Bounded per run so one click is bounded
 * work; run it again if more remain.
 */
const RECONCILE_BATCH_LIMIT = 500;

export async function reconcileCoverageCompetitions(): Promise<{ error: string | null; recordsProcessed: number }> {
  const supabase = createServiceRoleSupabaseClient();

  let providerName: string;
  try {
    providerName = (await getFootballDataProvider()).name;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), recordsProcessed: 0 };
  }

  const { data: rows, error } = await supabase
    .from("provider_coverage")
    .select("id, provider_competition_id")
    .eq("provider", providerName)
    .is("competition_id", null)
    .limit(RECONCILE_BATCH_LIMIT);

  if (error) {
    logError("football.sync-coverage.reconcileLoad", error);
    return { error: "Couldn't load unresolved coverage rows. Try again.", recordsProcessed: 0 };
  }
  if (!rows || rows.length === 0) return { error: null, recordsProcessed: 0 };

  let resolved = 0;
  for (const row of rows) {
    const competitionId = await findMappedId(supabase, providerName, "competition", row.provider_competition_id);
    if (!competitionId) continue;
    const { error: updateError } = await supabase
      .from("provider_coverage")
      .update({ competition_id: competitionId })
      .eq("id", row.id);
    if (updateError) {
      logError("football.sync-coverage.reconcileUpdate", updateError, { detail: `coverage row ${row.id}` });
      continue;
    }
    resolved += 1;
  }

  return { error: null, recordsProcessed: resolved };
}
