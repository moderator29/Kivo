import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";
import type { Database } from "@/lib/supabase/types";

type EntityType = Database["public"]["Enums"]["provider_entity_type"];

/**
 * RECOMMENDATIONS.md item 60: the "last updated" freshness readout on public football
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
export async function getLastUpdatedAt(entityTypes: EntityType[]): Promise<string | null> {
  // Same hardening, and for the same reason, as getTransparencyFreshness
  // below: /matches, /teams/[id], /players/[id] and /leagues/[id] are all
  // guest-viewable and all call this. `createServiceRoleSupabaseClient()`
  // throws *synchronously at construction* ("supabaseKey is required.") when
  // SUPABASE_SERVICE_ROLE_KEY is missing — rotated, mistyped, or simply not
  // set yet in a Preview environment — so leaving the construction outside
  // the try/catch let a footnote ("Updated 4h ago") replace four of the
  // most-trafficked pages in the app with the error boundary. The freshness
  // note renders nothing at all for a null
  // (src/components/football/last-updated-note.tsx), so degrading to null
  // reuses an existing, honest UI path instead of needing a new one: an
  // absent note is not a claim, and no claim is exactly what KIVO holds here.
  try {
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
      logError("football.getLastUpdatedAt", error, { entityTypes: entityTypes.join(",") });
      return null;
    }
    return data?.last_synced_at ?? null;
  } catch (error) {
    logError("football.getLastUpdatedAt", error, { entityTypes: entityTypes.join(",") });
    return null;
  }
}

/**
 * RECOMMENDATIONS.md item 176: "a 'what KIVO knows' transparency page" —
 * on a platform whose core promise is never fabricating data, showing users
 * exactly what is and is not loaded is a differentiating feature, not an
 * admin tool. Row counts are read from each entity's own public-select RLS
 * policy (see migration 0001's "Football reference data: readable by
 * everyone" block) directly in the page component; this helper carries the
 * one admin-restricted value a public page still needs — the overall
 * last-updated timestamp — through the same service-role-but-narrow pattern
 * getLastUpdatedAt already established above. Exactly one timestamp ever
 * leaves sync_runs here, nothing else on the row (no error text, no provider
 * name, no run id, no request count).
 *
 * BACKLOG 2026-08-20 (RECOMMENDATIONS.md F6): this used to return
 * `quotaRemaining` alongside the timestamp, read from
 * `sync_runs.provider_quota_remaining`. The frontend sweep removed the last
 * reader of it from /transparency and from the AI page's grounding footnote,
 * and the field then sat here as a value computed on every render of two
 * guest-viewable pages and thrown away. It is deleted rather than left
 * "harmless", for a reason narrower than tidiness: remaining request budget
 * is an operations metric, and a value a fan-facing code path can still reach
 * is a value the next author can render. Making it unreachable from here is
 * the structural version of the F1 rule — the operator's copy of this number
 * is on the Admin provider and pipeline pages, which read the column directly
 * and are the correct and only place for it.
 */
export async function getTransparencyFreshness(): Promise<{ lastUpdatedAt: string | null }> {
  // /transparency is guest-viewable — unlike Admin's Data Health, nothing
  // here can gate on a role check before reaching this call. A
  // `SUPABASE_SERVICE_ROLE_KEY` construction failure (missing env var) or
  // any other unexpected error from this privileged-but-narrow read must
  // never surface as a hard crash for an ordinary visitor; degrading to "not
  // yet reported" is the same honest-empty-state the page already renders
  // for a fresh install with no update history at all, so this reuses that
  // existing UI path rather than needing a new one.
  try {
    const service = createServiceRoleSupabaseClient();
    const { data: lastRun } = await service
      .from("sync_runs")
      .select("last_synced_at")
      .in("status", ["success", "partial"])
      .not("last_synced_at", "is", null)
      .order("last_synced_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return { lastUpdatedAt: lastRun?.last_synced_at ?? null };
  } catch (error) {
    logError("transparency.getTransparencyFreshness", error);
    return { lastUpdatedAt: null };
  }
}
