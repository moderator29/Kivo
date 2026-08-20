import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getFootballDataProvider } from "./index";
import { resolveCompetitionScope } from "./competition-scope";
import { syncStandings } from "./sync-match-details";
import { ensureSeason } from "./sync-catalogue";
import { reserveProviderRequests } from "./request-budget";
import { resolveTargetSeason, describeTargetSeason, type ResolvedTargetSeason } from "./target-season";
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
  /**
   * The season every table in `outcomes` belongs to, and where that year came
   * from. A league table gives a reader no way to tell 2024 from 2026 by
   * looking at it, so the surface that renders these outcomes is expected to
   * render this too.
   *
   * Optional rather than required only so an Admin action that refuses a press
   * on permission grounds — before anything is resolved — can keep returning a
   * bare literal while Admin is being restructured by another pass. Every
   * return from `syncScopedStandings` itself sets it, to a value or to null;
   * absent and null both mean "no season was resolved, because nothing ran".
   */
  season?: ResolvedTargetSeason | null;
  /** One sentence naming the season and its source, ready to render. */
  seasonSummary?: string | null;
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

  let provider;
  try {
    provider = await getFootballDataProvider();
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      outcomes: [],
      requestsSpent: 0,
      season: null,
      seasonSummary: null,
    };
  }

  const [scope, targetSeason] = await Promise.all([
    resolveCompetitionScope(supabase, provider.name),
    // Resolved HERE, once, and threaded through everything below.
    //
    // Before this, the target season had no effect on league tables at all:
    // `syncStandings` reads its year off the season row, and the rows are
    // whatever the fixture sync last saw kick off. An operator who set the
    // target season to a year their plan can serve — the entire point of
    // migration 0115 — got the same refusal as before, for a year they had not
    // chosen. Picking the season ROWS by the target year is what connects the
    // setting to the thing it is supposed to change.
    resolveTargetSeason(supabase, provider.name),
  ]);
  const seasonSummary = describeTargetSeason(targetSeason);

  const seasons = await selectSeasons(supabase, provider.name, scope.orderedIds, targetSeason);
  if (seasons.error) {
    return { error: seasons.error, outcomes: [], requestsSpent: 0, season: targetSeason, seasonSummary };
  }
  if (seasons.rows.length === 0) {
    return {
      error: targetSeason.isOverride
        ? `${seasonSummary} No competition KIVO can ask the provider about has a ${targetSeason.seasonYear} season on file, and none could be created — adopt the allowlisted competitions first, so there is a competition to attach a season to.`
        : "No current season has a competition KIVO can ask the provider about yet. Sync fixtures or adopt the allowlisted competitions first.",
      outcomes: [],
      requestsSpent: 0,
      season: targetSeason,
      seasonSummary,
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

  return { error: null, outcomes, requestsSpent: spent, season: targetSeason, seasonSummary };
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
  targetSeason: ResolvedTargetSeason,
): Promise<{ error: string | null; rows: SeasonTarget[] }> {
  /**
   * Two different questions, and which one is asked depends on whether anybody
   * has answered "which season?".
   *
   *   No override  -> `is_current`. The season the provider itself reported a
   *                   fixture for is the best available statement of which
   *                   season is running, and second-guessing it would mean
   *                   inventing an opinion KIVO does not have.
   *   An override  -> `provider_year = <the year that was chosen>`. The whole
   *                   reason an operator sets this is that `is_current` names a
   *                   season their plan refuses; honouring the setting means
   *                   not asking about that season.
   *
   * The override branch also CREATES the missing season rows, because on a
   * database whose seasons are all 2026 there is otherwise nothing for a 2024
   * table to attach to and the button would report "nothing to do" forever.
   * That write costs no provider request and asserts nothing that is not true —
   * a competition KIVO holds did have a 2024/25 season. `ensureSeason`
   * deliberately does not touch `is_current`, so creating one cannot blank out
   * the season that actually has fixtures.
   */
  const seasonQuery = supabase
    .from("seasons")
    .select("id, competition_id, competition:competitions(name, short_name)")
    .limit(200);

  const { data: seasons, error: seasonsError } = targetSeason.isOverride
    ? await seasonQuery.eq("provider_year", targetSeason.seasonYear)
    : await seasonQuery.eq("is_current", true);

  if (seasonsError) {
    logError("football.syncScopedStandings.seasons", seasonsError);
    return { error: "Couldn't read KIVO's seasons.", rows: [] };
  }

  const found = seasons ?? [];
  const backfilled = targetSeason.isOverride
    ? await ensureScopedSeasonRows(supabase, providerName, scopeProviderIds, targetSeason.seasonYear, found)
    : [];
  const allSeasons = [...found, ...backfilled];
  if (allSeasons.length === 0) return { error: null, rows: [] };

  const competitionIds = [...new Set(allSeasons.map((s) => s.competition_id))];

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
    .in("season_id", allSeasons.map((s) => s.id))
    .order("updated_at", { ascending: false })
    .limit(2000);

  const lastRefreshed = new Map<string, number>();
  for (const row of standingRows ?? []) {
    const at = new Date(row.updated_at).getTime();
    const known = lastRefreshed.get(row.season_id);
    if (known === undefined || at > known) lastRefreshed.set(row.season_id, at);
  }

  const targets: SeasonTarget[] = allSeasons
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

/** The shape `selectSeasons` reads out of `seasons`, so a row created on the
 * fly is indistinguishable from one that was already there. */
type SeasonRow = {
  id: string;
  competition_id: string;
  competition: { name: string | null; short_name: string | null } | null;
};

/**
 * Season rows for the operator's chosen year, for the competitions in scope
 * that do not have one yet.
 *
 * ## Why this is not "creating data"
 *
 * Nothing here is fetched, inferred or invented. A `seasons` row is a key: it
 * says "this competition has a 2024/25 season", which is true of every
 * competition that existed in 2024, and it is the only thing a `standings` row
 * can be filed under (`standings.season_id` is not null). Without it, an
 * operator who points KIVO at 2024 on a database whose season rows are all 2026
 * gets "nothing to do" from a button whose entire job is to fill 2024's tables.
 *
 * No table is written and no table is claimed. If the provider then refuses the
 * year, or returns nothing for it, the season row sits empty — which reads
 * exactly as it should: a season KIVO knows about and holds no table for.
 *
 * ## Bounded by the scope, on purpose
 *
 * Only competitions the operator actually covers. An unfiltered deployment gets
 * nothing created at all rather than a row per competition in the database —
 * eighty-six writes to serve a five-request budget is work nobody asked for,
 * and the seasons that already exist are still selected normally.
 */
async function ensureScopedSeasonRows(
  supabase: ReturnType<typeof createServiceRoleSupabaseClient>,
  providerName: string,
  scopeProviderIds: readonly string[],
  seasonYear: number,
  alreadyFound: readonly { competition_id: string }[],
): Promise<SeasonRow[]> {
  if (scopeProviderIds.length === 0) return [];

  const { data: mappings, error: mappingsError } = await supabase
    .from("provider_mappings")
    .select("kivo_entity_id, provider_entity_id")
    .eq("provider", providerName)
    .eq("entity_type", "competition")
    .in("provider_entity_id", [...scopeProviderIds]);

  if (mappingsError) {
    logError("football.syncScopedStandings.scopeMappings", mappingsError);
    return [];
  }

  const have = new Set(alreadyFound.map((s) => s.competition_id));
  const missing = (mappings ?? []).map((m) => m.kivo_entity_id).filter((id) => !have.has(id));
  if (missing.length === 0) return [];

  const { data: competitions, error: competitionsError } = await supabase
    .from("competitions")
    .select("id, name, short_name")
    .in("id", missing);

  if (competitionsError) {
    logError("football.syncScopedStandings.scopeCompetitions", competitionsError);
    return [];
  }

  const created: SeasonRow[] = [];
  for (const competition of competitions ?? []) {
    const seasonId = await ensureSeason(supabase, competition.id, seasonYear);
    // Null means the write failed and `ensureSeason` already logged it. Skipped
    // rather than reported: a competition with no season row simply is not in
    // this run, and inventing an outcome row for it would claim a table was
    // attempted when no request was ever made.
    if (!seasonId) continue;
    created.push({
      id: seasonId,
      competition_id: competition.id,
      competition: { name: competition.name, short_name: competition.short_name },
    });
  }
  return created;
}
