import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type EntityType = Database["public"]["Enums"]["provider_entity_type"];

/**
 * RECOMMENDATIONS.md item 60: "last synced" freshness display for public football
 * surfaces. `NormalizedFixture.retrievedAt` (src/lib/football/types.ts) is carried
 * specifically for this purpose but is discarded at the sync boundary (sync.ts's
 * upsertFixture never writes it anywhere) — rather than adding a new column (and
 * new provider-boundary wiring) to carry per-row freshness, this reads
 * `sync_runs.last_synced_at` instead: every sync writes it once per run, and a
 * run's provider calls all complete within the same request window that
 * retrievedAt would have recorded per-row, so for display purposes the two are
 * equivalent. See sync.ts/sync-squads.ts/sync-match-details.ts/sync-transfers.ts,
 * every one of which sets `last_synced_at: finishedAt` (identical to
 * `finished_at`) on every run.
 *
 * sync_runs is admin-only under RLS (`sync_runs_all_admin`, migration 0001), so
 * this goes through the service-role client like the other admin-restricted
 * reads on Data Health (src/app/admin/data-health/page.tsx) — only a timestamp
 * leaves this table for a public page, nothing else on the row.
 *
 * Only "success"/"partial" runs count — a "failed" run (e.g. quota exhausted
 * before anything was fetched) never actually refreshed the data a viewer is
 * looking at, so it shouldn't read as fresh.
 */
export async function getLastSyncedAt(entityTypes: EntityType[]): Promise<string | null> {
  const service = createServiceRoleSupabaseClient();
  const { data, error } = await service
    .from("sync_runs")
    .select("last_synced_at")
    .in("entity_type", entityTypes)
    .in("status", ["success", "partial"])
    .not("last_synced_at", "is", null)
    .order("last_synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("getLastSyncedAt: sync_runs query failed", error);
    return null;
  }
  return data?.last_synced_at ?? null;
}
