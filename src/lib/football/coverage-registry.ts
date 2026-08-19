import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { logError } from "@/lib/log";

type ServiceClient = SupabaseClient<Database>;

/**
 * Reading the coverage registry (`provider_coverage`, migration 0082).
 *
 * `coverage.ts` is the user-facing panel; this is the machine-facing answer to
 * one question, asked by both the UI and every sync that is about to spend a
 * request: **can this competition ever produce this?**
 *
 * ## Three answers, and the third one is load-bearing
 *
 *   supported    the provider says yes. An empty tab means unsynced.
 *   unsupported  the provider says no. An empty tab is permanent, and telling
 *                somebody to wait for it would be a lie.
 *   unknown      the provider said nothing, or KIVO has never synced the
 *                registry. This is where every competition starts.
 *
 * `unknown` must never be treated as `unsupported`. A sync that skipped on
 * `unknown` would mean a KIVO that has not yet refreshed its registry silently
 * stops fetching everything — a feature that turns itself off because it lacks
 * information about itself. So the rule is: skip on `unsupported`, attempt on
 * `unknown`, and let the attempt's own result be the evidence.
 */

/** The capabilities KIVO models. Names match `NormalizedCompetitionCoverage`,
 * so a reader can follow one word from the provider's JSON to this call. */
export type CoverageCapability =
  | "fixtureEvents"
  | "fixtureLineups"
  | "fixtureStatistics"
  | "fixturePlayerStatistics"
  | "standings"
  | "players"
  | "topScorers"
  | "topAssists"
  | "topCards"
  | "injuries"
  | "predictions"
  | "odds";

export type CapabilityVerdict = "supported" | "unsupported" | "unknown";

const COLUMN_FOR: Record<CoverageCapability, keyof Database["public"]["Tables"]["provider_coverage"]["Row"]> = {
  fixtureEvents: "fixture_events",
  fixtureLineups: "fixture_lineups",
  fixtureStatistics: "fixture_statistics",
  fixturePlayerStatistics: "fixture_player_statistics",
  standings: "standings",
  players: "players",
  topScorers: "top_scorers",
  topAssists: "top_assists",
  topCards: "top_cards",
  injuries: "injuries",
  predictions: "predictions",
  odds: "odds",
};

export type CompetitionCoverageRecord = {
  provider: string;
  seasonYear: number;
  competitionName: string | null;
  retrievedAt: string;
  verdicts: Record<CoverageCapability, CapabilityVerdict>;
};

function verdictFor(value: unknown): CapabilityVerdict {
  if (value === true) return "supported";
  if (value === false) return "unsupported";
  return "unknown";
}

/**
 * The registry's row for one competition, or null when the registry has never
 * been synced for it.
 *
 * `seasonYear` is optional because the common question is "what does the
 * provider support for this competition right now", and the newest row answers
 * it. Passing a year pins it, which is what a historical view needs.
 */
export async function getCompetitionCoverageRecord(
  supabase: ServiceClient,
  providerName: string,
  competitionId: string,
  seasonYear?: number,
): Promise<CompetitionCoverageRecord | null> {
  let query = supabase
    .from("provider_coverage")
    .select("*")
    .eq("provider", providerName)
    .eq("competition_id", competitionId);

  if (seasonYear !== undefined) query = query.eq("season_year", seasonYear);

  const { data, error } = await query.order("season_year", { ascending: false }).limit(1).maybeSingle();

  if (error) {
    // A registry read failure must not be reported as "unsupported" — that
    // would turn a transient database error into a permanent-sounding product
    // claim. Null means unknown, and unknown means attempt.
    logError("football.coverageRegistry.read", error, { competitionId, providerName });
    return null;
  }
  if (!data) return null;

  const verdicts = {} as Record<CoverageCapability, CapabilityVerdict>;
  for (const capability of Object.keys(COLUMN_FOR) as CoverageCapability[]) {
    verdicts[capability] = verdictFor(data[COLUMN_FOR[capability]]);
  }

  return {
    provider: data.provider,
    seasonYear: data.season_year,
    competitionName: data.competition_name,
    retrievedAt: data.retrieved_at,
    verdicts,
  };
}

/** One capability, for one competition. `unknown` when the registry has nothing. */
export async function getCompetitionCapability(
  supabase: ServiceClient,
  providerName: string,
  competitionId: string,
  capability: CoverageCapability,
  seasonYear?: number,
): Promise<CapabilityVerdict> {
  const record = await getCompetitionCoverageRecord(supabase, providerName, competitionId, seasonYear);
  return record?.verdicts[capability] ?? "unknown";
}

/**
 * The guard every quota-spending sync asks before it spends.
 *
 * Returns false ONLY on a definite `unsupported`. Everything else — supported,
 * unknown, an unsynced registry, a failed read — returns true, because the cost
 * of one wasted request is a request, and the cost of wrongly refusing is a
 * feature that silently never runs.
 */
export async function shouldAttemptCapability(
  supabase: ServiceClient,
  providerName: string,
  competitionId: string,
  capability: CoverageCapability,
  seasonYear?: number,
): Promise<{ attempt: boolean; verdict: CapabilityVerdict }> {
  const verdict = await getCompetitionCapability(supabase, providerName, competitionId, capability, seasonYear);
  return { attempt: verdict !== "unsupported", verdict };
}
