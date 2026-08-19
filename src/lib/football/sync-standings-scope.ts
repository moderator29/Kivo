import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getFootballDataProvider } from "./index";
import { getCompetitionScope } from "./competitions-config";
import { syncStandings } from "./sync-match-details";
import { reserveProviderRequests } from "./request-budget";
import { logError } from "@/lib/log";

/**
 * League tables, for the competitions KIVO has actually chosen to cover, on
 * demand.
 *
 * WHY THIS EXISTS AT ALL — `syncStandings` was never broken
 * ---------------------------------------------------------------------------
 * The founder's report was "no standing synced ... it's not calling it or
 * anything", and the second half of that sentence is the whole diagnosis.
 * `syncStandings` (sync-match-details.ts) is complete, correct and has been for
 * a long time. Checked against the live database: `sync_runs` contains not one
 * row with `entity_type = 'standing'`. Not a failed one. Not a partial one.
 * Zero. It has never been called.
 *
 * There were exactly two ways to call it:
 *
 *   1. The daily cron (`scheduled-sync.ts`), which fires at 05:00 UTC. On the
 *      only morning that mattered the provider account was still suspended, so
 *      it fetched nothing; the next firing is tomorrow.
 *   2. A per-season admin button, which needs the operator to already know
 *      which of 85 season ids is the one they want.
 *
 * Neither is "press this and the tables fill in", and that is the thing that
 * was missing. This module is that press.
 *
 * ORDER IS NOT A TASTE JUDGEMENT
 * ---------------------------------------------------------------------------
 * Tables are synced in the order of `getCompetitionScope().orderedIds` — the
 * operator's own configured allowlist, in the operator's own order. Nothing
 * here contains a list of league names, and nothing here decides that one
 * competition matters more than another. The shipped default happens to read
 * as the five European domestic leagues then the continental cups because that
 * is what KIVO is configured to cover; an operator who puts the NPFL first gets
 * the NPFL's table first, with no code change. This is the same signal
 * competition-tier.ts ranks the matches list by, read from the same function,
 * so the two can never disagree about what KIVO covers.
 *
 * On an unfiltered deployment there is no scope to order by, and rather than
 * invent one this falls back to exactly what the daily cron does:
 * least-recently-refreshed current seasons first, so an empty database fills
 * in rather than refreshing the same table forever.
 */

/**
 * Tables per press. Deliberately equal to the daily cron's own
 * `DAILY_STANDINGS_BUDGET`, because this press is the daily job done early
 * rather than a second, competing job — see the bucket note below.
 */
export const SCOPED_STANDINGS_LIMIT = 5;

/**
 * A table refreshed more recently than this is skipped, and the skip is
 * reported rather than silently counted as a success.
 *
 * A league table changes when matches are played. Six hours is short enough
 * that pressing this after a round of fixtures gets fresh tables, and long
 * enough that pressing it twice in a row does not spend five requests to
 * rewrite five identical tables — which, on a hundred-a-day tier, is the
 * difference between an operator exploring the panel and an operator locked
 * out of it.
 */
const FRESH_ENOUGH_HOURS = 6;

export type ScopedStandingsOutcome =
  | { competitionId: string; competitionName: string; status: "synced"; rows: number }
  | { competitionId: string; competitionName: string; status: "skipped"; reason: string }
  | { competitionId: string; competitionName: string; status: "failed"; reason: string };

export type ScopedStandingsResult = {
  error: string | null;
  outcomes: ScopedStandingsOutcome[];
  /** Provider requests actually spent. Reported rather than assumed equal to
   * the number of tables asked for: a reservation can be refused. */
  requestsSpent: number;
};

/**
 * Refreshes up to `SCOPED_STANDINGS_LIMIT` league tables.
 *
 * ## The bucket, and why it is `daily`
 *
 * One request per table, reserved from the **`daily`** bucket — the same one
 * the 05:00 cron's own standings pass draws on. That is deliberate and it has a
 * consequence worth stating plainly: pressing this can leave tomorrow's cron
 * with less allowance than it would otherwise have had.
 *
 * That is the correct outcome, not a cost to be engineered around. The cron's
 * standings budget exists to keep every current season's table coming round;
 * a press that refreshes five of those tables has done that work, and giving
 * the press its own separate allowance would mean KIVO could spend twice the
 * budgeted amount on the same job by doing it in both places. The alternative —
 * borrowing the `catalogue` bucket — would let a standings press starve the
 * club and squad backfill, which is a different job entirely.
 */
export async function syncScopedStandings(): Promise<ScopedStandingsResult> {
  const supabase = createServiceRoleSupabaseClient();
  const provider = await getFootballDataProvider();
  const scope = getCompetitionScope(provider.name);

  const seasons = await selectSeasons(supabase, provider.name, scope.orderedIds);
  if (seasons.error) return { error: seasons.error, outcomes: [], requestsSpent: 0 };
  if (seasons.rows.length === 0) {
    return {
      error:
        "No current season has a competition KIVO can ask the provider about yet. Sync fixtures or adopt the allowlisted competitions first.",
      outcomes: [],
      requestsSpent: 0,
    };
  }

  const freshCutoff = Date.now() - FRESH_ENOUGH_HOURS * 3600_000;
  const outcomes: ScopedStandingsOutcome[] = [];
  let spent = 0;

  for (const season of seasons.rows) {
    if (outcomes.filter((o) => o.status === "synced").length >= SCOPED_STANDINGS_LIMIT) break;

    if (season.lastRefreshedMs !== null && season.lastRefreshedMs > freshCutoff) {
      outcomes.push({
        competitionId: season.competitionId,
        competitionName: season.competitionName,
        status: "skipped",
        reason: `Refreshed less than ${FRESH_ENOUGH_HOURS} hours ago.`,
      });
      continue;
    }

    // Reserved immediately before the request, never in a batch up front: a
    // reservation made for work that then does not happen is an allowance
    // spent on nothing, and this loop can exit early.
    const decision = await reserveProviderRequests(supabase, provider.name, "daily", 1);
    if (!decision.allowed) {
      outcomes.push({
        competitionId: season.competitionId,
        competitionName: season.competitionName,
        status: "skipped",
        reason: "The daily provider allowance is spent. Try again after it rolls over.",
      });
      break;
    }
    spent += 1;

    const result = await syncStandings(season.seasonId);
    if (result.status === "failed") {
      outcomes.push({
        competitionId: season.competitionId,
        competitionName: season.competitionName,
        status: "failed",
        reason: result.error ?? "See the sync_runs row for details.",
      });
      continue;
    }

    outcomes.push({
      competitionId: season.competitionId,
      competitionName: season.competitionName,
      status: "synced",
      rows: result.recordsProcessed,
    });
  }

  return { error: null, outcomes, requestsSpent: spent };
}

type SeasonTarget = {
  seasonId: string;
  competitionId: string;
  competitionName: string;
  /** When this season's table was last written, or null if it never was. */
  lastRefreshedMs: number | null;
};

/**
 * The seasons to try, in the order to try them.
 *
 * Two orderings, one for each shape a deployment can be in, and the fallback is
 * the daily cron's own rule rather than a second opinion invented here.
 */
async function selectSeasons(
  supabase: ReturnType<typeof createServiceRoleSupabaseClient>,
  providerName: string,
  scopeProviderIds: readonly string[],
): Promise<{ error: string | null; rows: SeasonTarget[] }> {
  const { data: seasons, error: seasonsError } = await supabase
    .from("seasons")
    .select("id, competition_id, competition:competitions(name, short_name)")
    .eq("is_current", true)
    .limit(200);

  if (seasonsError) {
    logError("football.syncScopedStandings.seasons", seasonsError);
    return { error: "Couldn't read KIVO's seasons.", rows: [] };
  }
  if (!seasons || seasons.length === 0) return { error: null, rows: [] };

  const competitionIds = [...new Set(seasons.map((s) => s.competition_id))];

  // Which of these competitions the provider knows, and under which id. Read
  // directly rather than through get_competition_provider_ids: this runs as
  // service role, where provider_mappings is readable, and the RPC exists for
  // the browser-facing path that cannot read that table at all.
  const { data: mappings, error: mappingsError } = await supabase
    .from("provider_mappings")
    .select("kivo_entity_id, provider_entity_id")
    .eq("provider", providerName)
    .eq("entity_type", "competition")
    .in("kivo_entity_id", competitionIds);

  if (mappingsError) {
    logError("football.syncScopedStandings.mappings", mappingsError);
    return { error: "Couldn't read the provider's competition mappings.", rows: [] };
  }

  const providerIdByCompetition = new Map((mappings ?? []).map((m) => [m.kivo_entity_id, m.provider_entity_id]));

  // `standings.updated_at` is touched by the upsert on every refresh, so the
  // newest row per season is exactly when that table was last refreshed. Read
  // from the data itself rather than from a column on `seasons`, for the reason
  // the daily cron's own comment gives: a second source of truth for something
  // the rows already know is a second source of truth that can drift.
  const { data: standingRows } = await supabase
    .from("standings")
    .select("season_id, updated_at")
    .in("season_id", seasons.map((s) => s.id))
    .order("updated_at", { ascending: false })
    .limit(2000);

  const lastRefreshed = new Map<string, number>();
  for (const row of standingRows ?? []) {
    const at = new Date(row.updated_at).getTime();
    const known = lastRefreshed.get(row.season_id);
    if (known === undefined || at > known) lastRefreshed.set(row.season_id, at);
  }

  const targets: SeasonTarget[] = seasons
    // A competition with no provider mapping cannot be asked about at all —
    // syncStandings would fail on it and spend nothing but the operator's
    // patience. Dropped here rather than reported, because "KIVO has never
    // synced this competition" is not a standings problem.
    .filter((s) => providerIdByCompetition.has(s.competition_id))
    .map((s) => ({
      seasonId: s.id,
      competitionId: s.competition_id,
      competitionName: s.competition?.short_name || s.competition?.name || "Unnamed competition",
      lastRefreshedMs: lastRefreshed.get(s.id) ?? null,
    }));

  const scopePosition = new Map(scopeProviderIds.map((id, index) => [id, index]));

  if (scopePosition.size > 0) {
    const inScope = targets.filter((t) => scopePosition.has(providerIdByCompetition.get(t.competitionId) ?? ""));
    // Only competitions the operator configured. A deployment with an
    // allowlist has already answered "which competitions matter"; syncing
    // outside it would spend the allowance on tables the product does not show
    // prominently anyway.
    inScope.sort(
      (a, b) =>
        (scopePosition.get(providerIdByCompetition.get(a.competitionId) ?? "") ?? Number.MAX_SAFE_INTEGER) -
        (scopePosition.get(providerIdByCompetition.get(b.competitionId) ?? "") ?? Number.MAX_SAFE_INTEGER),
    );
    return { error: null, rows: inScope };
  }

  // Unfiltered deployment: no scope to order by. Least-recently-refreshed
  // first, exactly as syncStaleStandings does, so nothing is starved and an
  // empty database fills in.
  targets.sort((a, b) => {
    const aAt = a.lastRefreshedMs ?? Number.NEGATIVE_INFINITY;
    const bAt = b.lastRefreshedMs ?? Number.NEGATIVE_INFINITY;
    return aAt === bAt ? a.seasonId.localeCompare(b.seasonId) : aAt - bAt;
  });
  return { error: null, rows: targets };
}
