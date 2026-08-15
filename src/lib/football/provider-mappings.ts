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
 * sync.ts is deliberately NOT one of the importers here: its
 * upsertCompetition/upsertSeason/upsertTeam/upsertVenue/upsertFixture went
 * through SECURITY DEFINER RPCs in migration 0018 (RECOMMENDATIONS item 22),
 * so it no longer calls findMappedId/createMapping at all — only
 * batchFindMappedIds, which stays local to sync.ts since it's still the only
 * file that does batched, whole-run-up-front lookups (see its doc comment
 * there). Folding a single-caller helper in here too would be a false
 * consolidation, not a real one.
 */
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
