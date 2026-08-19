import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { logError } from "@/lib/log";
import type { FootballDataProvider } from "./types";
import type { SyncResult } from "./sync";
import { reapAbandonedSyncRuns } from "./sync-instrumentation";

type ServiceClient = SupabaseClient<Database>;
type EntityType = Database["public"]["Enums"]["provider_entity_type"];
type SyncStatus = Database["public"]["Enums"]["sync_status"];

/**
 * The `sync_runs` bookkeeping every sync in this codebase performs, written
 * once.
 *
 * `sync.ts`, `sync-squads.ts`, `sync-match-details.ts` and `sync-transfers.ts`
 * each carry their own hand-rolled copy of "insert a running row, update it at
 * the end, remember to record the provider's quota on BOTH paths". They predate
 * each other and are near-identical, and the one line most often forgotten in a
 * new copy is `provider_quota_remaining` on the failure path — which is exactly
 * the run where knowing the remaining quota matters most, because a 429 IS the
 * failure.
 *
 * This branch adds five more syncs. Writing that block five more times would
 * have been five more chances to forget it, so it is a helper. Deliberately not
 * retrofitted onto the four existing callers in this pass: they work, they are
 * covered by their own behaviour, and rewriting four hot files that other agents
 * are editing tonight to save duplication is a bad trade. `RECOMMENDATIONS.md`
 * carries the follow-up.
 *
 * The one rule it enforces that a hand-rolled copy tends not to:
 * `last_synced_at` is set only when the run actually refreshed something. A
 * failed run leaves data exactly as stale as it found it, and `auto-sync.ts`
 * reads that column to decide freshness — a failure that stamped it would tell
 * the whole platform the data is fresh.
 */
export class SyncRunRecorder {
  private constructor(
    private readonly supabase: ServiceClient,
    private readonly provider: FootballDataProvider,
    readonly runId: string,
  ) {}

  /**
   * Opens a run row. Returns null when the row could not be created — the
   * caller must then decline to do the work rather than proceed unrecorded,
   * because unrecorded provider spend is invisible to Data Health and to every
   * quota guard that reads this table.
   */
  static async start(
    supabase: ServiceClient,
    provider: FootballDataProvider,
    entityType: EntityType,
    triggerSource?: string,
  ): Promise<SyncRunRecorder | null> {
    // Close anything a dead process left `running` before adding another row.
    // Every sync that uses this class therefore also cleans up after the ones
    // that died — see reapAbandonedSyncRuns for why a `finally` cannot.
    await reapAbandonedSyncRuns(supabase);

    const { data, error } = await supabase
      .from("sync_runs")
      .insert({
        provider: provider.name,
        entity_type: entityType,
        status: "running",
        ...(triggerSource ? { trigger_source: triggerSource } : {}),
      })
      .select("id")
      .single();

    if (error || !data) {
      logError("football.syncRun.start", error, { entityType });
      return null;
    }
    return new SyncRunRecorder(supabase, provider, data.id);
  }

  /**
   * Closes the run and returns the caller's own result shape.
   *
   * `errors` is the full list; only the first twenty reach `error_message`,
   * matching the existing convention — a column that holds an unbounded join of
   * every failure stops being readable long before it stops being written.
   */
  async finish(status: SyncStatus, processed: number, errors: readonly string[] = []): Promise<SyncResult> {
    const finishedAt = new Date().toISOString();
    const errorMessage = errors.length > 0 ? errors.slice(0, 20).join("; ") : null;

    const { error } = await this.supabase
      .from("sync_runs")
      .update({
        status,
        finished_at: finishedAt,
        // Only a run that refreshed data may claim freshness. See this class's
        // doc comment.
        last_synced_at: status === "failed" || status === "skipped" ? null : finishedAt,
        records_processed: processed,
        records_failed: errors.length,
        error_message: errorMessage,
        // On success AND on failure: the provider sends its quota header either
        // way, and a 429 is precisely when this number is worth having.
        provider_quota_remaining: this.provider.getQuotaRemaining(),
      })
      .eq("id", this.runId);

    if (error) logError("football.syncRun.finish", error, { runId: this.runId });

    return {
      status: status === "failed" ? "failed" : "succeeded",
      recordsProcessed: processed,
      error: errorMessage ?? undefined,
    };
  }

  /** Convenience for the common "some rows failed" verdict. Failed only when
   * there was work to do and none of it landed — a run that processed some rows
   * is partial, not failed, because the rows it did write are real. */
  static verdict(processed: number, errorCount: number, hadWork: boolean): SyncStatus {
    if (errorCount === 0) return "success";
    if (hadWork && processed === 0) return "failed";
    return "partial";
  }
}
