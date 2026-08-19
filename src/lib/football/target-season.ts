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
  const label = `${resolved.seasonYear}/${String((resolved.seasonYear + 1) % 100).padStart(2, "0")}`;
  if (!resolved.isOverride) {
    return `KIVO is syncing the ${label} season — the current season by the calendar.`;
  }
  const where =
    resolved.source === "database"
      ? "set by an operator"
      : `set by the ${TARGET_SEASON_ENV} environment variable`;
  const because = resolved.reason ? ` Reason given: ${resolved.reason}` : "";
  const calendarLabel = `${resolved.calendarSeasonYear}/${String((resolved.calendarSeasonYear + 1) % 100).padStart(2, "0")}`;
  return `KIVO is syncing the ${label} season, ${where} — not the current ${calendarLabel} season.${because}`;
}
