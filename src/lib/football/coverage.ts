import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getActiveProviderStatus } from "./index";

/**
 * "For this competition, does KIVO have lineups? stats? standings?" (KN-103).
 *
 * `/transparency` answers the platform-wide version of this question. The
 * version a person actually has is narrower and more useful: they are looking
 * at one competition, and they want to know what to expect from it before they
 * click a tab that turns out to be empty.
 *
 * The distinction that makes this honest rather than decorative — and the one
 * the coverage registry (RECOMMENDATIONS item 299) exists to make properly — is
 * between three genuinely different states:
 *
 *   "KIVO has this"          — real rows exist, and they are counted.
 *   "Not synced yet"         — the provider can supply it and nobody has asked.
 *   "This provider can't"    — the active provider has no endpoint for it, so
 *                              no amount of syncing will ever produce it.
 *
 * Collapsing the last two into one empty state is the thing that makes an
 * honest product feel broken: a user staring at an empty Lineups tab deserves
 * to know whether waiting will help.
 */

export type CoverageState = "present" | "not-synced" | "unsupported";

export type CoverageArea = {
  key: string;
  label: string;
  state: CoverageState;
  /** Real row count. Zero for anything not present; never shown as a claim. */
  count: number;
  /** One line explaining the state, in the user's terms. */
  detail: string;
};

export type CompetitionCoverage = {
  providerLabel: string | null;
  areas: CoverageArea[];
};

/**
 * What each provider can actually supply, transcribed from the capability
 * matrix in `docs/PROVIDER_ABSTRACTION.md` — which is itself sourced from each
 * provider's real endpoints, with the TheSportsDB entries reflecting methods
 * that deliberately *throw* rather than return an empty result, precisely so
 * "unsupported" and "empty" stay distinguishable.
 *
 * Keyed by the provider names `getActiveProviderStatus` returns. A provider
 * absent from this map is treated as supporting everything, because claiming a
 * capability gap KIVO has not established would be its own fabrication.
 */
const PROVIDER_UNSUPPORTED: Record<string, ReadonlySet<string>> = {
  "api-football": new Set(),
  // Free tier: no confirmed lineup, event-timeline or per-fixture stats
  // endpoint, and no transfer history at all. See the capability matrix.
  thesportsdb: new Set(["lineups", "events", "statistics", "transfers"]),
};

export async function getCompetitionCoverage(
  competitionId: string,
  currentSeasonId: string | null,
): Promise<CompetitionCoverage> {
  const supabase = createServerSupabaseClient();
  const { name: providerName, label: providerLabel } = getActiveProviderStatus();
  const unsupported = providerName ? (PROVIDER_UNSUPPORTED[providerName] ?? new Set<string>()) : new Set<string>();

  // Every count is scoped to this competition through an inner join on
  // `fixtures`, rather than by first fetching fixture ids and passing them back
  // in — which would break silently the moment a competition has more fixtures
  // than one request can carry.
  const [fixtures, finished, lineups, events, statistics, standings] = await Promise.all([
    supabase.from("fixtures").select("id", { count: "exact", head: true }).eq("competition_id", competitionId),
    supabase
      .from("fixtures")
      .select("id", { count: "exact", head: true })
      .eq("competition_id", competitionId)
      .eq("status", "finished"),
    supabase
      .from("lineups")
      .select("id, fixture:fixtures!inner(competition_id)", { count: "exact", head: true })
      .eq("fixture.competition_id", competitionId),
    supabase
      .from("fixture_events")
      .select("id, fixture:fixtures!inner(competition_id)", { count: "exact", head: true })
      .eq("fixture.competition_id", competitionId),
    supabase
      .from("fixture_statistics")
      .select("id, fixture:fixtures!inner(competition_id)", { count: "exact", head: true })
      .eq("fixture.competition_id", competitionId),
    currentSeasonId
      ? supabase.from("standings").select("id", { count: "exact", head: true }).eq("season_id", currentSeasonId)
      : Promise.resolve({ count: 0 }),
  ]);

  const finishedCount = finished.count ?? 0;

  const area = (
    key: string,
    label: string,
    count: number,
    notSyncedDetail: string,
    unsupportedDetail: string,
  ): CoverageArea => {
    if (count > 0) {
      return { key, label, state: "present", count, detail: `${count.toLocaleString("en-GB")} recorded.` };
    }
    if (unsupported.has(key)) {
      return { key, label, state: "unsupported", count: 0, detail: unsupportedDetail };
    }
    return { key, label, state: "not-synced", count: 0, detail: notSyncedDetail };
  };

  return {
    providerLabel,
    areas: [
      area(
        "fixtures",
        "Fixtures",
        fixtures.count ?? 0,
        "No fixtures for this competition have been synced yet.",
        "This competition's fixtures aren't available from the current data source.",
      ),
      area(
        "standings",
        "League table",
        standings.count ?? 0,
        currentSeasonId
          ? "No table synced for the current season yet."
          : "No current season is set for this competition yet, so there's no table to sync.",
        "The current data source doesn't publish a table for this competition.",
      ),
      area(
        "lineups",
        "Lineups",
        lineups.count ?? 0,
        finishedCount > 0
          ? "Not synced yet — lineups are pulled per match, not with the fixture list."
          : "Nothing to show until a match in this competition has been played.",
        "The current data source has no lineup data at all.",
      ),
      area(
        "events",
        "Goals and cards",
        events.count ?? 0,
        finishedCount > 0
          ? "Not synced yet — match events are pulled per match."
          : "Nothing to show until a match in this competition has been played.",
        "The current data source has no match-event timeline.",
      ),
      area(
        "statistics",
        "Match stats",
        statistics.count ?? 0,
        finishedCount > 0
          ? "Not synced yet — stats are pulled per match."
          : "Nothing to show until a match in this competition has been played.",
        "The current data source has no per-match statistics.",
      ),
    ],
  };
}
