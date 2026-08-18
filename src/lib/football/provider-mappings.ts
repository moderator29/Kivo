import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type ServiceClient = SupabaseClient<Database>;
type EntityType = Database["public"]["Enums"]["provider_entity_type"];

/**
 * Shared `provider_mappings` helpers (RECOMMENDATIONS.md item 29). findMappedId,
 * findProviderEntityId and createMapping were byte-for-byte identical copies in
 * sync-squads.ts, sync-match-details.ts and sync-transfers.ts (each with its own
 * "deliberately duplicated" comment left over from an earlier file-scope
 * constraint that no longer applies) — extracted here so there's one definition
 * to read and one place to fix if provider_mappings' shape ever changes.
 *
 * sync.ts does not use findMappedId/createMapping: its
 * upsertCompetition/upsertSeason/upsertTeam/upsertVenue/upsertFixture went
 * through SECURITY DEFINER RPCs in migration 0018 (RECOMMENDATIONS item 22).
 * It does use batchFindMappedIds below, which used to live privately inside
 * sync.ts with a note here explaining that folding a single-caller helper in
 * would be a false consolidation. That was right at the time and stopped being
 * right when sync-match-details.ts became the second caller
 * (KIVO_NEXT_GEN KN-12) — so it moved here, with the chunking that a second
 * caller made necessary.
 */

/**
 * How many provider ids go into one `in.(…)` filter.
 *
 * The batched lookup this replaces was written for `syncTodayFixtures`, whose
 * id sets are a day's worth of fixtures. sync-match-details.ts calls it with a
 * fixture's players (~44) and a season's standings teams (~20), which is
 * smaller — but the fixtures caller can genuinely be hundreds on a broad day,
 * and those ids ride in a URL-encoded GET filter. 200 uuids is roughly 8KB of
 * query string; 100 keeps a real margin under every proxy default without
 * making a normal day cost more than one request per entity type.
 */
const PROVIDER_ID_CHUNK_SIZE = 100;

/**
 * One `provider_mappings` round trip per chunk of provider ids of a given
 * entity type, instead of one round trip per entity.
 *
 * RECOMMENDATIONS.md item 27 introduced this for `syncTodayFixtures`;
 * KIVO_NEXT_GEN KN-12 is the same treatment for `sync-match-details.ts`, which
 * item 27's pass never reached: `processLineupSide` looked up one player at a
 * time (~22 per side, ~44 per fixture), `processEvents` up to four ids per
 * event, and `syncStandings` re-resolved every team in the table one by one.
 *
 * Callers thread the returned map through their upserts as the existence
 * check, and mutate it in place when they insert something new, so a later
 * item in the same run that references the same provider id reuses it instead
 * of inserting again. Empty input issues no request at all.
 */
export async function batchFindMappedIds(
  supabase: ServiceClient,
  provider: string,
  entityType: EntityType,
  providerEntityIds: string[],
): Promise<Map<string, string>> {
  const known = new Map<string, string>();
  const unique = [...new Set(providerEntityIds)];
  if (unique.length === 0) return known;

  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += PROVIDER_ID_CHUNK_SIZE) {
    chunks.push(unique.slice(i, i + PROVIDER_ID_CHUNK_SIZE));
  }

  const results = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from("provider_mappings")
        .select("provider_entity_id, kivo_entity_id")
        .eq("provider", provider)
        .eq("entity_type", entityType)
        .in("provider_entity_id", chunk),
    ),
  );

  for (const { data, error } of results) {
    if (error) throw error;
    for (const row of data ?? []) known.set(row.provider_entity_id, row.kivo_entity_id);
  }
  return known;
}
export async function findMappedId(
  supabase: ServiceClient,
  provider: string,
  entityType: EntityType,
  providerEntityId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("provider_mappings")
    .select("kivo_entity_id")
    .eq("provider", provider)
    .eq("entity_type", entityType)
    .eq("provider_entity_id", providerEntityId)
    .maybeSingle();

  if (error) throw error;
  return data?.kivo_entity_id ?? null;
}

/** Reverse of findMappedId — given a KIVO id, find the provider's own id for it.
 * Used by call sites that are handed a KIVO fixture/season/player id and need
 * to go the other direction to call the provider API. */
export async function findProviderEntityId(
  supabase: ServiceClient,
  provider: string,
  entityType: EntityType,
  kivoEntityId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("provider_mappings")
    .select("provider_entity_id")
    .eq("provider", provider)
    .eq("entity_type", entityType)
    .eq("kivo_entity_id", kivoEntityId)
    .maybeSingle();

  if (error) throw error;
  return data?.provider_entity_id ?? null;
}

export async function createMapping(
  supabase: ServiceClient,
  provider: string,
  entityType: EntityType,
  providerEntityId: string,
  kivoEntityId: string,
): Promise<void> {
  const { error } = await supabase
    .from("provider_mappings")
    .insert({ provider, entity_type: entityType, provider_entity_id: providerEntityId, kivo_entity_id: kivoEntityId });
  // 23505 = another concurrent sync already created this mapping — fine, it points
  // at the same kivo entity either way.
  if (error && error.code !== "23505") throw error;
}
