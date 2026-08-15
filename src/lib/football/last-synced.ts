import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";
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

/**
 * RECOMMENDATIONS.md item 176: "a 'what KIVO knows' transparency page" —
 * on a platform whose core promise is never fabricating data, showing users
 * exactly what is and is not loaded is a differentiating feature, not an
 * admin tool. Row counts are read from each entity's own public-select RLS
 * policy (see migration 0001's "Football reference data: readable by
 * everyone" block) directly in the page component; this helper only carries
 * the two admin-restricted numbers a public page still needs — overall last
 * synced timestamp and current provider quota — through the same
 * service-role-but-narrow pattern getLastSyncedAt already established above.
 * Only a timestamp and an integer ever leave sync_runs here, nothing else on
 * the row (no error text, no provider name, no run id).
 */
export async function getTransparencyFreshness(): Promise<{ lastSyncedAt: string | null; quotaRemaining: number | null }> {
  // /transparency is guest-viewable — unlike Admin's Data Health, nothing
  // here can gate on a role check before reaching this call. A
  // `SUPABASE_SERVICE_ROLE_KEY` construction failure (missing env var) or
  // any other unexpected error from this privileged-but-narrow read must
  // never surface as a hard crash for an ordinary visitor; degrading to "not
  // yet reported" is the same honest-empty-state the page already renders
  // for a fresh install with no sync history at all, so this reuses that
  // existing UI path rather than needing a new one.
  try {
    const service = createServiceRoleSupabaseClient();
    const [{ data: lastRun }, { data: quotaRun }] = await Promise.all([
      service
        .from("sync_runs")
        .select("last_synced_at")
        .in("status", ["success", "partial"])
        .not("last_synced_at", "is", null)
        .order("last_synced_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      service
        .from("sync_runs")
        .select("provider_quota_remaining")
        .not("provider_quota_remaining", "is", null)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    return {
      lastSyncedAt: lastRun?.last_synced_at ?? null,
      quotaRemaining: quotaRun?.provider_quota_remaining ?? null,
    };
  } catch (error) {
    logError("transparency.getTransparencyFreshness", error);
    return { lastSyncedAt: null, quotaRemaining: null };
  }
}
