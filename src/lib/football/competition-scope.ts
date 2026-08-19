import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getCompetitionScope, type CompetitionScope, type CompetitionScopeSource } from "./competitions-config";
import { logError } from "@/lib/log";

/**
 * The competitions KIVO covers, resolved against the database.
 *
 * WHY THERE IS A DATABASE LAYER AT ALL
 * ---------------------------------------------------------------------------
 * The founder asked for the top five European leagues, and also for the Saudi
 * Pro League, MLS and an Asian league. Five shipped. The rest did not, and
 * neither did the NPFL, for one reason: **nobody could establish those league
 * ids with certainty, and a wrong league id does not fail — it silently syncs a
 * different competition.**
 *
 * That is not hypothetical. This database holds Emperor Cup, U19 Bundesliga and
 * III Liga Group 2 because the pipeline once took whatever happened to kick
 * off. An id typed from memory is the same mistake wearing a more confident
 * face, and it is unfalsifiable from the UI: the screen looks identical whether
 * the number was right or wrong.
 *
 * So the answer is not a better guess. It is to stop guessing: the operator
 * picks a competition out of `provider_coverage`, the provider's own registry,
 * where every entry carries the id, name and country the provider itself
 * reports. One `/leagues` request fills that registry with everything on the
 * plan, and browsing it costs nothing.
 *
 * PRECEDENCE
 * ---------------------------------------------------------------------------
 *   1. rows in `competition_scope`  → the operator's choice, in their order
 *   2. FOOTBALL_SYNC_COMPETITION_IDS → the environment variable
 *   3. the shipped default           → DEFAULT_API_FOOTBALL_COMPETITIONS
 *   4. no filter                     → every competition the provider reports
 *
 * An EMPTY table means "this feature is not in use" and falls through to 2, not
 * "cover nothing". An empty allowlist would scope every sync to zero and read
 * to a fan as "there is no football today", which is the worst sentence this
 * system can produce and one it has already produced once for a different
 * reason.
 *
 * A FAILED READ ALSO FALLS THROUGH, deliberately, and logs. The static answer
 * is a worse answer than the operator's, and it is not a wrong one — where
 * blanking the scope on a transient database error would silently change what
 * the pipeline syncs.
 */

type Client = SupabaseClient<Database>;

export type ResolvedCompetitionScope = Omit<CompetitionScope, "source"> & {
  source: CompetitionScopeSource | "database";
  /** Names and countries for the ids, when the scope came from the database —
   * so an admin surface can list what is covered without a second query. */
  entries: readonly { providerId: string; label: string | null; country: string | null }[];
};

export async function resolveCompetitionScope(
  supabase: Client,
  providerName: string,
): Promise<ResolvedCompetitionScope> {
  const fallback = getCompetitionScope(providerName);

  const { data, error } = await supabase
    .from("competition_scope")
    .select("provider_entity_id, label, country, position")
    .eq("provider", providerName)
    .order("position", { ascending: true });

  if (error) {
    logError("football.resolveCompetitionScope", error, { provider: providerName });
    return { ...fallback, entries: [] };
  }

  // No rows is not an empty allowlist. See the precedence note above.
  if (!data || data.length === 0) return { ...fallback, entries: [] };

  const orderedIds = data.map((row) => row.provider_entity_id);
  return {
    providerIds: new Set(orderedIds),
    orderedIds,
    source: "database",
    entries: data.map((row) => ({
      providerId: row.provider_entity_id,
      label: row.label,
      country: row.country,
    })),
  };
}

/**
 * The membership test the fixture sync uses, in the same precedence order.
 *
 * Null means "no filter" and is a real answer — it is what an unfiltered
 * deployment gets, and what a provider KIVO has no vetted list for gets. It is
 * never the result of a failed read: that returns the static scope instead.
 */
export async function resolveSyncedCompetitionProviderIds(
  supabase: Client,
  providerName: string,
): Promise<Set<string> | null> {
  return (await resolveCompetitionScope(supabase, providerName)).providerIds;
}
