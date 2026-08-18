import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

/**
 * The four questions `sync_runs` alone could never answer, each backed by real
 * rows and nothing else (KN-81, KN-86, KN-88, KN-95).
 *
 * Every query here runs through the RLS-enforced server client, not the
 * service-role one. All four tables are admin-only at the policy layer, so a
 * caller without the role gets empty results from the database itself rather
 * than from a check in this file — the access rule lives in one place and this
 * cannot drift out of agreement with it.
 */

export type SyncHealthRow = Database["public"]["Functions"]["get_sync_health_summary"]["Returns"][number];
export type AnomalySummaryRow = Database["public"]["Functions"]["get_data_anomaly_summary"]["Returns"][number];

export type OpenSyncFailure = {
  id: string;
  provider: string;
  entityType: Database["public"]["Enums"]["provider_entity_type"];
  providerEntityId: string;
  errorMessage: string;
  label: string | null;
  createdAt: string;
};

export type RecentAnomaly = {
  id: string;
  anomalyType: Database["public"]["Enums"]["data_anomaly_type"];
  provider: string;
  detail: string;
  createdAt: string;
  reviewedAt: string | null;
};

export type SyncReliabilityReport = {
  health: SyncHealthRow[];
  anomalySummary: AnomalySummaryRow[];
  openFailures: OpenSyncFailure[];
  recentAnomalies: RecentAnomaly[];
  /** Fixtures the provider stopped reporting and nobody has looked at yet. */
  flaggedAbsentFixtures: number;
};

const HEALTH_WINDOW_DAYS = 14;
const ANOMALY_WINDOW_DAYS = 7;
const LIST_LIMIT = 15;

export async function getSyncReliabilityReport(): Promise<SyncReliabilityReport> {
  const supabase = createServerSupabaseClient();

  const [health, anomalySummary, failures, anomalies, absent] = await Promise.all([
    supabase.rpc("get_sync_health_summary", { p_days: HEALTH_WINDOW_DAYS }),
    supabase.rpc("get_data_anomaly_summary", { p_days: ANOMALY_WINDOW_DAYS }),
    supabase
      .from("sync_run_failures")
      .select("id, provider, entity_type, provider_entity_id, error_message, context, created_at")
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT),
    supabase
      .from("data_anomalies")
      .select("id, anomaly_type, provider, detail, created_at, reviewed_at")
      .is("reviewed_at", null)
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT),
    supabase
      .from("fixtures")
      .select("id", { count: "exact", head: true })
      .not("absence_flagged_at", "is", null),
  ]);

  return {
    health: health.data ?? [],
    anomalySummary: anomalySummary.data ?? [],
    openFailures: (failures.data ?? []).map((row) => ({
      id: row.id,
      provider: row.provider,
      entityType: row.entity_type,
      providerEntityId: row.provider_entity_id,
      errorMessage: row.error_message,
      // `context` is deliberately loose jsonb (a failure's useful detail differs
      // by entity type), so read the one key this UI knows about defensively
      // rather than casting the whole object into a shape it may not have.
      label:
        typeof row.context === "object" && row.context !== null && "label" in row.context
          ? String((row.context as { label?: unknown }).label ?? "")
          : null,
      createdAt: row.created_at,
    })),
    recentAnomalies: (anomalies.data ?? []).map((row) => ({
      id: row.id,
      anomalyType: row.anomaly_type,
      provider: row.provider,
      detail: row.detail,
      createdAt: row.created_at,
      reviewedAt: row.reviewed_at,
    })),
    flaggedAbsentFixtures: absent.count ?? 0,
  };
}

export const SYNC_HEALTH_WINDOW_DAYS = HEALTH_WINDOW_DAYS;
export const SYNC_ANOMALY_WINDOW_DAYS = ANOMALY_WINDOW_DAYS;
