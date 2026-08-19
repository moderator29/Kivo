import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { logError } from "@/lib/log";
import { getCompetitionScope } from "./competitions-config";
import { NO_COMPETITION_RANKING_SIGNALS, type CompetitionRankingSignals } from "./competition-tier";

type Client = SupabaseClient<Database>;

/**
 * Reads the real signals `rankCompetitionGroups` orders competitions by. The
 * derivation and the reasoning behind each signal live in
 * src/lib/football/competition-tier.ts; this file is only the fetch.
 *
 * Three reads, all bounded by the competitions already on screen:
 *
 *   - the viewer's own competition follows (plain RLS read of `follows` —
 *     `follows_select_own` already scopes it to them);
 *   - the active provider's league id per competition
 *     (`get_competition_provider_ids`, migration 0111);
 *   - how many profiles follow each competition
 *     (`get_competition_follower_counts`, migration 0111).
 *
 * A failure in any of them degrades that one signal to "absent" and is logged.
 * It does not fail the page: the worst case is the list keeps the kickoff
 * order it had before this existed, which is a worse ordering but never a
 * wrong claim. Ordering is not one of the three facts the product must keep
 * apart ("nothing here" / "couldn't load" / "not supported") — the fixtures
 * themselves are still exactly what the database returned.
 */
export async function getCompetitionRankingSignals(
  supabase: Client,
  competitionIds: string[],
  viewerProfileId: string | null,
): Promise<CompetitionRankingSignals> {
  const uniqueIds = [...new Set(competitionIds)];
  if (uniqueIds.length === 0) return NO_COMPETITION_RANKING_SIGNALS;

  // Which provider's ids `provider_mappings` was written under, and which
  // provider `getCompetitionScope` should hand back a scope for.
  //
  // Deliberately the *configured* provider, mirroring resolveProviderChoice()
  // in src/lib/football/index.ts, and NOT `getActiveProviderStatus()`. That
  // function additionally requires the provider's API key to be present,
  // because it answers "can KIVO sync right now". This is reading rows that
  // were already synced — it spends no quota and needs no key — so gating it
  // on key presence would blank the ordering on any deployment where the key
  // lives only in the sync environment.
  const providerName = process.env.FOOTBALL_DATA_PROVIDER === "thesportsdb" ? "thesportsdb" : "api-football";
  const scope = getCompetitionScope(providerName);

  const [favouritesResult, providerIdsResult, followerCountsResult] = await Promise.all([
    viewerProfileId
      ? supabase
          .from("follows")
          .select("followed_id")
          .eq("follower_profile_id", viewerProfileId)
          .eq("followed_type", "competition")
      : Promise.resolve({ data: [], error: null }),
    // Skipped entirely when the pipeline is unfiltered: with no scope there is
    // nothing to match against, so the round trip would buy nothing.
    scope.orderedIds.length > 0
      ? supabase.rpc("get_competition_provider_ids", { p_provider: providerName, p_competition_ids: uniqueIds })
      : Promise.resolve({ data: [], error: null }),
    supabase.rpc("get_competition_follower_counts", { p_competition_ids: uniqueIds }),
  ]);

  if (favouritesResult.error) logError("competition-ranking.favourites", favouritesResult.error);
  if (providerIdsResult.error) logError("competition-ranking.providerIds", providerIdsResult.error);
  if (followerCountsResult.error) logError("competition-ranking.followerCounts", followerCountsResult.error);

  return {
    favouriteCompetitionIds: new Set((favouritesResult.data ?? []).map((row) => row.followed_id)),
    scopeProviderIds: scope.orderedIds,
    providerIdByCompetitionId: new Map(
      (providerIdsResult.data ?? []).map((row) => [row.competition_id, row.provider_competition_id] as const),
    ),
    followerCountByCompetitionId: new Map(
      (followerCountsResult.data ?? []).map((row) => [row.competition_id, Number(row.follower_count)] as const),
    ),
  };
}
