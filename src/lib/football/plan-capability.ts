import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getFootballDataProvider } from "./index";
import { parseSupportedSeasonRange } from "./providers/api-football-request";
import { resolveTargetSeason, type ResolvedTargetSeason } from "./target-season";
import type { NormalizedProviderPlan } from "./types";
import { logError } from "@/lib/log";

type ServiceClient = SupabaseClient<Database>;

/**
 * One screen that answers "what can this account actually do, and what is
 * blocked, and why".
 *
 * ## Why this is a whole module
 *
 * On 2026-08-19 the live database held 705 teams, 354 fixtures, and zero
 * players, zero managers, zero standings, zero lineups, zero transfers, zero
 * competition_teams and zero coverage rows. Nothing on any screen said why.
 * The reason was one sentence sitting in a `sync_runs.error_message` column
 * that nobody had reason to read:
 *
 *   "Free plans do not have access to this season, try from 2022 to 2024."
 *
 * Every season-scoped endpoint was being refused and every one of them failed
 * looking like an empty table. That is this project's recurring bug class
 * stated exactly: **a failed read drawn as an empty state.** The fix is not
 * more retries; it is a page that says which endpoints are refused, on whose
 * authority, and what to change.
 *
 * ## What is evidence and what is not
 *
 * Everything here is one of two things, and the type keeps them apart:
 *
 *   - what the PROVIDER SAID — the plan from `/status`, the refusal messages
 *     recorded in `sync_runs`. Quoted, attributed, never paraphrased into a
 *     claim of KIVO's own.
 *   - what KIVO KNOWS ABOUT ITSELF — which endpoints it calls with a `season`
 *     parameter. That is read off this codebase, not guessed at, and it is a
 *     fact about KIVO rather than a claim about the provider's pricing.
 *
 * A capability whose status is `unknown` says unknown. It never degrades to
 * "available" (which would promise something) or to "blocked" (which would
 * blame a plan on no evidence).
 */

/**
 * Every provider call KIVO makes, and whether it carries a season.
 *
 * The `seasonScoped` column is the load-bearing one and it is derived from the
 * actual request paths in `providers/api-football.ts`, not from the provider's
 * pricing page. It is what predicts a plan refusal: on a free API-Football
 * plan, a request with `season=<a year the plan does not cover>` is refused
 * with HTTP 200 and an `errors.plan` body, and a request without a season
 * parameter is not.
 *
 * That prediction is exactly why 705 teams and 354 fixtures exist and nothing
 * else does — `/fixtures?date=` is the only season-free endpoint anything had
 * called.
 */
export interface ProviderCapability {
  /** What a person would call this, not the method name. */
  label: string;
  /** The provider path KIVO actually requests, season parameter included. */
  endpoint: string;
  /** True when the request carries a `season` parameter and is therefore
   * subject to the plan's season window. */
  seasonScoped: boolean;
  /** What is empty in KIVO when this endpoint cannot be called. */
  fills: string;
}

/** API-Football's surface as KIVO calls it. Ordered so the season-free
 * endpoints — the ones that work right now — come first, because an operator
 * reading this needs to know what they already have before what they are
 * missing. */
export const API_FOOTBALL_CAPABILITIES: readonly ProviderCapability[] = [
  { label: "Fixtures by date", endpoint: "/fixtures?date=", seasonScoped: false, fills: "fixtures, competitions, teams, venues" },
  { label: "Live fixtures", endpoint: "/fixtures?live=all", seasonScoped: false, fills: "live scores" },
  { label: "One fixture", endpoint: "/fixtures?id=", seasonScoped: false, fills: "a single match's detail" },
  { label: "Squad", endpoint: "/players/squads?team=", seasonScoped: false, fills: "players" },
  { label: "Manager", endpoint: "/coachs?team=", seasonScoped: false, fills: "managers" },
  { label: "Lineups", endpoint: "/fixtures/lineups?fixture=", seasonScoped: false, fills: "lineups" },
  { label: "Match events", endpoint: "/fixtures/events?fixture=", seasonScoped: false, fills: "goals, cards, substitutions" },
  { label: "Match statistics", endpoint: "/fixtures/statistics?fixture=", seasonScoped: false, fills: "team match statistics" },
  { label: "Player match statistics", endpoint: "/fixtures/players?fixture=", seasonScoped: false, fills: "player match statistics and provider ratings" },
  { label: "Player transfers", endpoint: "/transfers?player=", seasonScoped: false, fills: "a player's transfer history" },
  { label: "Team transfers", endpoint: "/transfers?team=", seasonScoped: false, fills: "a club's transfer history" },
  { label: "Account status", endpoint: "/status", seasonScoped: false, fills: "this page" },
  { label: "Coverage registry", endpoint: "/leagues?season=", seasonScoped: true, fills: "provider_coverage — the competition picker, and every competition's country" },
  { label: "Clubs in a league", endpoint: "/teams?league=&season=", seasonScoped: true, fills: "competition_teams, club countries and founding years" },
  { label: "Standings", endpoint: "/standings?league=&season=", seasonScoped: true, fills: "standings" },
  { label: "Injuries", endpoint: "/injuries?league=&season=", seasonScoped: true, fills: "injuries" },
  { label: "Top scorers", endpoint: "/players/topscorers?league=&season=", seasonScoped: true, fills: "top_scorers" },
  { label: "Player season statistics", endpoint: "/players?id=&season=", seasonScoped: true, fills: "player_season_statistics" },
];

export type CapabilityStatus = "available" | "blocked" | "unknown";

export interface CapabilityVerdict extends ProviderCapability {
  status: CapabilityStatus;
  /** Plain words. Why this status, and what to do about it. */
  reason: string;
}

/** A plan refusal KIVO has actually received, quoted from `sync_runs`. */
export interface RecordedRefusal {
  entityType: string;
  at: string;
  /** The provider's own sentence, verbatim. */
  message: string;
}

export interface PlanCapabilityReport {
  providerName: string;
  /** The provider's own account statement, or null when this provider
   * publishes none / the call failed. Null is "not known", never "free". */
  plan: NormalizedProviderPlan | null;
  /** Why `plan` is null, when it is. */
  planUnavailableReason: string | null;
  targetSeason: ResolvedTargetSeason;
  /** The season window the provider named in its most recent refusal. This is
   * evidence about a past request, not a property of the account — labelled as
   * such wherever it is shown. Null when no refusal has ever named one. */
  supportedSeasonsPerLastRefusal: { from: number; to: number } | null;
  /** True when the target season sits outside that window. The single fact
   * that explains an otherwise inexplicable empty database. */
  targetSeasonIsRefused: boolean;
  refusals: RecordedRefusal[];
  capabilities: CapabilityVerdict[];
}

/**
 * Reads the plan refusals KIVO has actually been given.
 *
 * Deliberately a query against `sync_runs` rather than a fresh provider call:
 * asking the provider to refuse KIVO again, in order to display the refusal,
 * would spend quota to learn something already written down. The messages are
 * matched on the wording `describePlanRefusal` produces and on the provider's
 * own raw phrasing, so refusals recorded before that function existed — which
 * is all of the ones on the live database — are still found.
 */
async function readRecordedRefusals(supabase: ServiceClient, providerName: string): Promise<RecordedRefusal[]> {
  const { data, error } = await supabase
    .from("sync_runs")
    .select("entity_type, started_at, error_message")
    .eq("provider", providerName)
    .not("error_message", "is", null)
    .order("started_at", { ascending: false })
    .limit(100);

  if (error) {
    logError("football.planCapability.refusals", error, { provider: providerName });
    return [];
  }

  const seen = new Set<string>();
  const refusals: RecordedRefusal[] = [];
  for (const row of data ?? []) {
    const message = row.error_message;
    if (!message) continue;
    if (!/plan does not cover|does not have access to this season|\(plan\)|upgrade your plan/i.test(message)) continue;
    // One entry per entity type: the same refusal repeated eleven times is
    // eleven rows of noise hiding the one other thing that also failed.
    if (seen.has(row.entity_type)) continue;
    seen.add(row.entity_type);
    refusals.push({ entityType: row.entity_type, at: row.started_at, message });
  }
  return refusals;
}

/**
 * The verdict for one endpoint.
 *
 * Three states, and the third one is the point. `unknown` is returned whenever
 * KIVO has no evidence either way — a season-scoped endpoint with no recorded
 * refusal and no known season window is genuinely unknown, and saying
 * "available" there would be a promise KIVO cannot keep.
 */
function verdictFor(
  capability: ProviderCapability,
  targetSeasonIsRefused: boolean,
  window: { from: number; to: number } | null,
  targetSeason: number,
): CapabilityVerdict {
  if (!capability.seasonScoped) {
    return {
      ...capability,
      status: "available",
      reason:
        "Carries no season parameter, so the plan's season window does not apply to it. If this one is empty, the cause is something other than the plan.",
    };
  }

  if (targetSeasonIsRefused && window) {
    return {
      ...capability,
      status: "blocked",
      reason: `Asks for season ${targetSeason}, which the provider has said this plan does not cover (it named ${window.from} to ${window.to}). Point KIVO's target season inside that range, or upgrade the plan.`,
    };
  }

  if (window) {
    return {
      ...capability,
      status: "available",
      reason: `Asks for season ${targetSeason}, which is inside the ${window.from}-${window.to} window the provider named. Nothing about the plan is blocking this one.`,
    };
  }

  return {
    ...capability,
    status: "unknown",
    reason: `Asks for season ${targetSeason}. The provider has not told KIVO which seasons this plan covers, so whether this is allowed is genuinely unknown until it is tried.`,
  };
}

/**
 * The whole report. One provider request (`/status`), one `sync_runs` query,
 * one `provider_season_target` lookup.
 *
 * `/status` is called rather than inferred because the alternative is KIVO
 * guessing at somebody's subscription from the shape of an error, and a wrong
 * guess here sends the founder to fix the wrong thing. It carries no season
 * parameter, so it answers on precisely the plan whose seasons are refused.
 */
export async function buildPlanCapabilityReport(supabase: ServiceClient): Promise<PlanCapabilityReport> {
  const provider = await getFootballDataProvider();

  const [targetSeason, refusals] = await Promise.all([
    resolveTargetSeason(supabase, provider.name),
    readRecordedRefusals(supabase, provider.name),
  ]);

  let plan: NormalizedProviderPlan | null = null;
  let planUnavailableReason: string | null = null;
  try {
    plan = await provider.getProviderPlan();
    if (plan === null) {
      planUnavailableReason = `${provider.name} publishes no account endpoint, so KIVO cannot report which plan this key belongs to. That is a gap in what is knowable, not a statement that the plan is free.`;
    }
  } catch (err) {
    planUnavailableReason = `Could not read the account status from ${provider.name}: ${err instanceof Error ? err.message : String(err)}`;
    logError("football.planCapability.status", err, { provider: provider.name });
  }

  const window = refusals.reduce<{ from: number; to: number } | null>(
    (found, refusal) => found ?? parseSupportedSeasonRange(refusal.message),
    null,
  );

  const targetSeasonIsRefused =
    window !== null && (targetSeason.seasonYear < window.from || targetSeason.seasonYear > window.to);

  // The capability table is API-Football's request surface, read off
  // `providers/api-football.ts`. Under another provider it would be a list of
  // endpoints KIVO does not call, presented as if it did — so it is empty
  // rather than wrong. `docs/PROVIDER_ABSTRACTION.md` carries TheSportsDB's own
  // capability matrix; duplicating a guessed version of it here would be worse
  // than showing nothing.
  const capabilities =
    provider.name === "api-football"
      ? API_FOOTBALL_CAPABILITIES.map((capability) =>
          verdictFor(capability, targetSeasonIsRefused, window, targetSeason.seasonYear),
        )
      : [];

  return {
    providerName: provider.name,
    plan,
    planUnavailableReason,
    targetSeason,
    supportedSeasonsPerLastRefusal: window,
    targetSeasonIsRefused,
    refusals,
    capabilities,
  };
}
