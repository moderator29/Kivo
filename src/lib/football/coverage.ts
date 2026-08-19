import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getActiveProviderStatus } from "./index";
import { getCompetitionCoverageRecord, type CoverageCapability } from "./coverage-registry";

/**
 * "For this competition, does KIVO have lineups? stats? standings?" (KN-103,
 * and RECOMMENDATIONS item 299's registry, now real).
 *
 * `/transparency` answers the platform-wide version of this question. The
 * version a person actually has is narrower and more useful: they are looking
 * at one competition, and they want to know what to expect from it before they
 * click a tab that turns out to be empty.
 *
 * ## Four states, and the two middle ones are the whole point
 *
 *   "KIVO has this"      real rows exist, and they are counted.
 *   "Not synced yet"     the provider says it supports this; nobody has asked.
 *   "This can't fill"    the provider says it does not support this here. No
 *                        amount of syncing will ever produce it.
 *   "Not established"    nobody has asked the provider what it supports. KIVO
 *                        does not know, and says so.
 *
 * Collapsing the middle two is what makes an honest product feel broken: a user
 * staring at an empty Lineups tab deserves to know whether waiting will help.
 * Collapsing the last one into either of the others is worse — it is KIVO
 * asserting a fact about the provider that it has not established.
 *
 * ## Where "can't fill" now comes from
 *
 * Until migration 0082 the only available answer was a hand-transcribed,
 * per-PROVIDER capability map (still below, as the fallback). That map can say
 * "TheSportsDB has no lineups at all" and cannot say "this provider has no
 * lineups FOR THIS COMPETITION" — which is the case that actually bites, since
 * API-Football covers a top-flight league and a lower division very
 * differently.
 *
 * `provider_coverage` is the provider's own per-competition declaration, and it
 * takes precedence wherever it has an opinion. The static map remains
 * underneath for the case the registry cannot cover: a provider whose method
 * genuinely throws (TheSportsDB) regardless of competition, and any competition
 * whose registry row has not been synced yet.
 */

export type CoverageState = "present" | "not-synced" | "unsupported" | "unknown";

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
  /** True when the registry has a row for this competition, so the panel can
   * say whether its "can't fill" answers are the provider's own or KIVO's
   * inference from the provider's method list. */
  registrySynced: boolean;
  /** When the registry row was last refreshed. Null when there is none. */
  registryRetrievedAt: string | null;
};

/**
 * What each provider can supply AT ALL, transcribed from the capability matrix
 * in `docs/PROVIDER_ABSTRACTION.md` — itself sourced from each provider's real
 * endpoints, with the TheSportsDB entries reflecting methods that deliberately
 * *throw* rather than return an empty result, precisely so "unsupported" and
 * "empty" stay distinguishable.
 *
 * This is the floor, not the authority: it is consulted only where the coverage
 * registry has no opinion. A provider absent from this map is treated as
 * supporting everything, because claiming a capability gap KIVO has not
 * established would be its own fabrication.
 */
const PROVIDER_UNSUPPORTED: Record<string, ReadonlySet<string>> = {
  "api-football": new Set(),
  // Free tier: no confirmed lineup, event-timeline or per-fixture stats
  // endpoint, no per-player match statistics, no injuries, no scoring charts,
  // and no transfer history at all. See the capability matrix.
  thesportsdb: new Set(["lineups", "events", "statistics", "player-stats", "injuries", "top-scorers", "transfers"]),
};

/** Which registry capability, if any, speaks for each area of the panel. */
const CAPABILITY_FOR_AREA: Record<string, CoverageCapability | null> = {
  // The leagues response has no "does this league have fixtures" flag — a
  // competition appearing in it at all is the closest thing, and that is not a
  // capability statement. Left to the static map rather than invented.
  fixtures: null,
  standings: "standings",
  lineups: "fixtureLineups",
  events: "fixtureEvents",
  statistics: "fixtureStatistics",
  "player-stats": "fixturePlayerStatistics",
  "top-scorers": "topScorers",
  injuries: "injuries",
};

export async function getCompetitionCoverage(
  competitionId: string,
  currentSeasonId: string | null,
): Promise<CompetitionCoverage> {
  const supabase = createServerSupabaseClient();
  const { name: providerName, label: providerLabel } = getActiveProviderStatus();
  const staticUnsupported = providerName
    ? (PROVIDER_UNSUPPORTED[providerName] ?? new Set<string>())
    : new Set<string>();

  // The registry is keyed by the provider's own season year, which lives on the
  // season row. Resolved first so the lookup pins the season the page is
  // showing rather than whatever the newest registry row happens to be.
  const { data: seasonRow } = currentSeasonId
    ? await supabase.from("seasons").select("provider_year").eq("id", currentSeasonId).maybeSingle()
    : { data: null };

  // Every count is scoped to this competition through an inner join on
  // `fixtures`, rather than by first fetching fixture ids and passing them back
  // in — which would break silently the moment a competition has more fixtures
  // than one request can carry.
  const [fixtures, finished, lineups, events, statistics, playerStats, topScorers, injuries, standings, registry] =
    await Promise.all([
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
      supabase
        .from("fixture_player_statistics")
        .select("id, fixture:fixtures!inner(competition_id)", { count: "exact", head: true })
        .eq("fixture.competition_id", competitionId),
      currentSeasonId
        ? supabase.from("top_scorers").select("id", { count: "exact", head: true }).eq("season_id", currentSeasonId)
        : Promise.resolve({ count: 0 }),
      supabase.from("injuries").select("id", { count: "exact", head: true }).eq("competition_id", competitionId),
      currentSeasonId
        ? supabase.from("standings").select("id", { count: "exact", head: true }).eq("season_id", currentSeasonId)
        : Promise.resolve({ count: 0 }),
      providerName
        ? getCompetitionCoverageRecord(
            supabase,
            providerName,
            competitionId,
            seasonRow?.provider_year ?? undefined,
          )
        : Promise.resolve(null),
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

    // The provider's own per-competition word first, where it has one.
    const capability = CAPABILITY_FOR_AREA[key];
    const verdict = capability && registry ? registry.verdicts[capability] : undefined;
    if (verdict === "unsupported") {
      return { key, label, state: "unsupported", count: 0, detail: unsupportedDetail };
    }

    // Then the provider-wide floor: a method that throws for every competition.
    if (staticUnsupported.has(key)) {
      return { key, label, state: "unsupported", count: 0, detail: unsupportedDetail };
    }

    // The provider said it supports this, so an empty section is genuinely a
    // sync away.
    if (verdict === "supported") {
      return { key, label, state: "not-synced", count: 0, detail: notSyncedDetail };
    }

    // Nothing has established either way. Said plainly rather than guessed —
    // this is a real state, and it resolves itself the first time the coverage
    // registry is synced.
    if (capability) {
      return {
        key,
        label,
        state: "unknown",
        count: 0,
        detail: providerLabel
          ? `KIVO hasn't checked yet whether ${providerLabel} publishes this for this competition.`
          : "No data source is configured, so KIVO can't tell whether this is available.",
      };
    }

    return { key, label, state: "not-synced", count: 0, detail: notSyncedDetail };
  };

  const nothingPlayedYet = "Nothing to show until a match in this competition has been played.";

  return {
    providerLabel,
    registrySynced: registry !== null,
    registryRetrievedAt: registry?.retrievedAt ?? null,
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
        finishedCount > 0 ? "Not synced yet — lineups are pulled per match, not with the fixture list." : nothingPlayedYet,
        "The current data source publishes no lineups for this competition.",
      ),
      area(
        "events",
        "Goals and cards",
        events.count ?? 0,
        finishedCount > 0 ? "Not synced yet — match events are pulled per match." : nothingPlayedYet,
        "The current data source publishes no match-event timeline for this competition.",
      ),
      area(
        "statistics",
        "Match stats",
        statistics.count ?? 0,
        finishedCount > 0 ? "Not synced yet — stats are pulled per match." : nothingPlayedYet,
        "The current data source publishes no per-match statistics for this competition.",
      ),
      area(
        "player-stats",
        "Player match stats",
        playerStats.count ?? 0,
        finishedCount > 0
          ? "Not synced yet — per-player numbers are pulled per match, separately from team stats."
          : nothingPlayedYet,
        "The current data source publishes no per-player match statistics for this competition — which is also why player heatmaps here are built from formation and match events rather than from a player's full involvement.",
      ),
      area(
        "top-scorers",
        "Top scorers",
        topScorers.count ?? 0,
        currentSeasonId
          ? "No scoring chart synced for the current season yet."
          : "No current season is set for this competition yet, so there's no chart to sync.",
        "The current data source publishes no scoring chart for this competition.",
      ),
      area(
        "injuries",
        "Injuries and absences",
        injuries.count ?? 0,
        "No absence reports synced for this competition yet.",
        "The current data source publishes no injury reports for this competition.",
      ),
    ],
  };
}
