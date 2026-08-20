import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { logError } from "@/lib/log";

/**
 * The season year KIVO asks the provider for.
 *
 * WHY THIS MODULE EXISTS
 * ---------------------------------------------------------------------------
 * KIVO derived the season from the calendar and nothing else. That arithmetic
 * is right and it is currently why the platform is empty. The provider's own
 * words, recorded in `sync_runs.error_message` on the live database:
 *
 *   "API-Football refused the request (plan): Free plans do not have access to
 *    this season, try from 2022 to 2024."
 *
 * Every endpoint that takes a `season` parameter is refused outright on a free
 * plan asking for 2026: `/standings`, `/teams?league=&season=`,
 * `/leagues?season=`, `/injuries`, `/players/topscorers`, `/players?id=&season=`.
 * Every endpoint that does NOT take one is unaffected and works today:
 * `/fixtures?date=`, `/fixtures?live=all`, `/players/squads?team=`,
 * `/coachs?team=`, `/fixtures/{lineups,events,statistics,players}?fixture=`,
 * `/transfers?player=|team=`. That split is the whole shape of the problem, and
 * it is why a single settable number unblocks most of the platform.
 *
 * PRECEDENCE
 * ---------------------------------------------------------------------------
 *   1. a `provider_season_target` row  -> the operator's choice (migration 0115)
 *   2. FOOTBALL_TARGET_SEASON          -> the environment variable
 *   3. currentProviderSeason()         -> the calendar. THE DEFAULT.
 *
 * THE DEFAULT MUST STAY THE REAL CURRENT SEASON, and every caller that resolves
 * an override is expected to say so out loud. A fan looking at a standings
 * table cannot tell 2024 from 2026 by looking at it; only KIVO can tell them,
 * and quietly showing a two-year-old season while implying it is this one is a
 * worse failure than showing nothing. `isOverride` on the result exists for
 * exactly that — it is not decoration.
 *
 * A FAILED READ FALLS THROUGH AND LOGS. A transient database error must not
 * silently change which season the pipeline syncs; the same posture
 * `competition-scope.ts` takes for the competition allowlist.
 */

type Client = SupabaseClient<Database>;

export const TARGET_SEASON_ENV = "FOOTBALL_TARGET_SEASON";

/**
 * The season to ask about when nobody has named one.
 *
 * API-Football identifies a season by its starting year, so the 2025/26 season
 * is 2025. Northern-hemisphere seasons start in July/August, so before July the
 * current season is still last calendar year's. This is a calendar fact about
 * how the provider numbers things, not a guess about football.
 *
 * Lives here rather than in `sync-coverage.ts` (where it was born) because it
 * is now the bottom of a three-step precedence chain rather than the only
 * answer — `sync-coverage.ts` re-exports it so existing importers are
 * unaffected.
 */
export function currentProviderSeason(now: Date = new Date()): number {
  const year = now.getUTCFullYear();
  // getUTCMonth is 0-based; 6 is July.
  return now.getUTCMonth() >= 6 ? year : year - 1;
}

export type TargetSeasonSource = "database" | "environment" | "calendar";

export interface ResolvedTargetSeason {
  /** The year to send to the provider. */
  seasonYear: number;
  /** Where it came from — rendered wherever the year is, never dropped. */
  source: TargetSeasonSource;
  /** The calendar answer, always computed, so a surface can show both and let
   * the reader see the gap for themselves rather than being told about it. */
  calendarSeasonYear: number;
  /** True when `seasonYear` is not the calendar's answer. The single flag every
   * UI is expected to branch on. */
  isOverride: boolean;
  /** The operator's stated reason, when the override came from the database. */
  reason: string | null;
  /** When the database override was last written. */
  setAt: string | null;
}

/**
 * Parses `FOOTBALL_TARGET_SEASON`.
 *
 * Rejects anything that is not a plausible season year rather than coercing it.
 * `Number("")` is 0 and `Number("2024-25")` is NaN, and both would otherwise
 * become a season the provider silently returns nothing for — an unparseable
 * value has to degrade to "not set" and say so in the log, never to a number
 * nobody chose.
 */
export function parseTargetSeasonEnv(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (!/^\d{4}$/.test(trimmed)) {
    logError(
      "football.targetSeason.env",
      new Error(
        `${TARGET_SEASON_ENV} must be a four-digit season starting year (e.g. 2024, meaning the 2024/25 season). Got "${raw}". Ignoring it and falling back to the calendar season.`,
      ),
    );
    return null;
  }
  const parsed = Number(trimmed);
  if (parsed < 1888 || parsed > 2100) {
    logError(
      "football.targetSeason.env",
      new Error(`${TARGET_SEASON_ENV}=${raw} is outside the plausible range 1888-2100. Ignoring it.`),
    );
    return null;
  }
  return parsed;
}

/** Steps 2 and 3 of the chain, with no database involved. Exported so callers
 * that genuinely have no client (and tests) can still get an honest answer. */
export function resolveTargetSeasonWithoutDatabase(now: Date = new Date()): ResolvedTargetSeason {
  const calendarSeasonYear = currentProviderSeason(now);
  const fromEnv = parseTargetSeasonEnv(process.env[TARGET_SEASON_ENV]);

  if (fromEnv !== null) {
    return {
      seasonYear: fromEnv,
      source: "environment",
      calendarSeasonYear,
      isOverride: fromEnv !== calendarSeasonYear,
      reason: null,
      setAt: null,
    };
  }

  return {
    seasonYear: calendarSeasonYear,
    source: "calendar",
    calendarSeasonYear,
    isOverride: false,
    reason: null,
    setAt: null,
  };
}

/**
 * The full chain. One indexed primary-key lookup; safe to call on every sync.
 *
 * Never throws: an error reading the table falls through to the environment
 * variable and then the calendar, and logs. Silently syncing a different season
 * because a query blipped is exactly the class of failure this module exists to
 * make visible.
 */
export async function resolveTargetSeason(
  supabase: Client,
  providerName: string,
  now: Date = new Date(),
): Promise<ResolvedTargetSeason> {
  const withoutDatabase = resolveTargetSeasonWithoutDatabase(now);

  try {
    const { data, error } = await supabase
      .from("provider_season_target")
      .select("season_year, reason, updated_at")
      .eq("provider", providerName)
      .maybeSingle();

    if (error) {
      logError("football.targetSeason.read", error, { provider: providerName });
      return withoutDatabase;
    }
    if (!data) return withoutDatabase;

    return {
      seasonYear: data.season_year,
      source: "database",
      calendarSeasonYear: withoutDatabase.calendarSeasonYear,
      isOverride: data.season_year !== withoutDatabase.calendarSeasonYear,
      reason: data.reason,
      setAt: data.updated_at,
    };
  } catch (error) {
    logError("football.targetSeason.read", error, { provider: providerName });
    return withoutDatabase;
  }
}

/**
 * Convenience for the many sync entry points shaped
 * `(…, season?: number) => …`: an explicit argument always wins, and only its
 * absence consults the chain.
 */
export async function resolveSeasonYear(
  supabase: Client,
  providerName: string,
  explicitSeason: number | undefined,
): Promise<number> {
  if (explicitSeason !== undefined) return explicitSeason;
  return (await resolveTargetSeason(supabase, providerName)).seasonYear;
}

/**
 * One sentence naming the year and where it came from, for any surface that
 * shows synced data. Deliberately plain: the point is that a reader who is not
 * an engineer understands which season they are looking at.
 */
export function describeTargetSeason(resolved: ResolvedTargetSeason): string {
  const label = seasonLabel(resolved.seasonYear);
  if (!resolved.isOverride) {
    return `KIVO is syncing the ${label} season — the current season by the calendar.`;
  }
  const where =
    resolved.source === "database"
      ? "set by an operator"
      : `set by the ${TARGET_SEASON_ENV} environment variable`;
  const because = resolved.reason ? ` Reason given: ${resolved.reason}` : "";
  const calendarLabel = seasonLabel(resolved.calendarSeasonYear);

  /**
   * The trade, said out loud, in the same sentence as the setting.
   *
   * Naming the year was never the hard part. What an operator cannot see from
   * the number alone is that this choice is not confined to Admin: it decides
   * what a fan reads on a league table, a scoring chart and a player's season
   * page, and none of those screens looks any different for being two seasons
   * out of date. A setting whose consequence is invisible on every surface it
   * changes has to carry its consequence in its own description.
   *
   * The squad exception is not a footnote. `/players/squads` and `/coachs`
   * carry no season parameter, so squads and managers are current whatever this
   * is set to — an operator weighing "should I point at 2024" deserves to know
   * that the thing they most want is not what they are trading away.
   */
  const gap = resolved.calendarSeasonYear - resolved.seasonYear;
  const staleness =
    gap > 0
      ? ` Every league table, scoring chart and player season page KIVO syncs will be ${label} — ${gap} season${gap === 1 ? "" : "s"} behind what a reader will assume they are looking at, unless the screen says otherwise.`
      : "";
  const unaffected =
    " Squads and managers are unaffected either way: those requests carry no season, so they stay current.";
  const reversible = ` Clearing this puts KIVO back on ${calendarLabel} for the next sync; nothing already synced moves.`;

  return `KIVO is syncing the ${label} season, ${where} — not the current ${calendarLabel} season.${because}${staleness}${unaffected}${reversible}`;
}

/** `YYYY/YY`, the way a season is written on a shirt. */
function seasonLabel(year: number): string {
  return `${year}/${String((year + 1) % 100).padStart(2, "0")}`;
}

/**
 * The sentence for a season row that is not the season the operator chose, or
 * null when there is nothing to say.
 *
 * ## The disagreement this exists to end
 *
 * Every season-scoped sync in this codebase resolves its year through
 * `resolveSeasonYear` — except `syncStandings`, which takes the year off the
 * `seasons` row it is given, because a standings table belongs to the season it
 * is filed under and writing 2024's table into the 2026 row would be a worse
 * bug than asking for the wrong year.
 *
 * Both of those are right, and together they were silently wrong. On the live
 * database the season rows carry provider years 2025, 2026 and 2027 — whatever
 * the fixture sync last saw kick off — so a standings press asked for a year
 * nobody had chosen, and `describePlanRefusal` then told the operator that
 * setting the target season would make "every season-scoped sync start
 * working", which for this one was not true.
 *
 * So the year is still the row's. What changes is that a row which contradicts
 * an operator's explicit choice is refused BEFORE a request is spent, and the
 * refusal names both years rather than letting the provider name one of them.
 *
 * Returns null when no override is in force — the calendar is not a choice
 * anybody made, and refusing a row for disagreeing with it would stop standings
 * working on a plan that has no season problem at all.
 */
export function describeSeasonRowMismatch(
  resolved: ResolvedTargetSeason,
  rowSeasonYear: number,
): string | null {
  if (!resolved.isOverride) return null;
  if (resolved.seasonYear === rowSeasonYear) return null;

  const where = resolved.source === "database" ? "set by an operator" : `set by ${TARGET_SEASON_ENV}`;
  return (
    `This season row is the ${seasonLabel(rowSeasonYear)} season, but KIVO's target season is ${resolved.seasonYear} (${where}). ` +
    `Asking the provider for ${rowSeasonYear} would spend a request on a season this deployment has deliberately pointed away from, so nothing was sent. ` +
    `Refresh the league tables for the competitions in scope instead — that syncs the ${seasonLabel(resolved.seasonYear)} season — or clear the target season to sync ${seasonLabel(rowSeasonYear)} again.`
  );
}
