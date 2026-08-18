import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

/**
 * Whether each way football data can arrive has *ever actually arrived that
 * way* — read from real `sync_runs` rows, not from configuration.
 *
 * This exists because of a specific, repeated failure: something is built,
 * documented and deployed, and then quietly never runs, because the last step
 * was a dashboard action nobody took. It has happened twice on this project.
 * A paragraph in `ENVIRONMENT.md` did not prevent it either time, because the
 * person who needs to know is looking at an empty screen, not at a markdown
 * file.
 *
 * So the product says it. Every status below is "has a run with this trigger
 * source ever landed", which is the only question that cannot be answered
 * wrongly by an env var being set in the wrong place, a deployment not having
 * happened, or a secret being pasted into the wrong project.
 *
 * Deliberately not inferred from configuration. `process.env.CRON_SECRET`
 * being present tells you nothing about whether Vercel is calling anything,
 * and reading it here would produce a confident green tick for a schedule that
 * does not exist. A row, or no row.
 */

export type AutomationLayerId = "auto" | "daily" | "cron";

export type AutomationLayerStatus = {
  id: AutomationLayerId;
  /** Most recent run with this trigger source, or null if there has never been one. */
  lastRunAt: string | null;
  /** Runs in the last 24h — distinguishes "working" from "worked once, weeks ago". */
  runsLast24h: number;
  /** Most recent run that actually refreshed data, as opposed to deciding not to. */
  lastSuccessAt: string | null;
};

export type AutomationStatus = {
  layers: Record<AutomationLayerId, AutomationLayerStatus>;
  /** True when nothing at all has ever synced — the state that makes every football surface empty. */
  neverSynced: boolean;
};

type SyncRunRow = {
  trigger_source: string;
  started_at: string;
  last_synced_at: string | null;
  status: Database["public"]["Enums"]["sync_status"];
};

const LAYER_IDS: AutomationLayerId[] = ["auto", "daily", "cron"];

export async function getAutomationStatus(): Promise<AutomationStatus> {
  const supabase = createServerSupabaseClient();

  // One query, not three. `sync_runs` is admin-only under RLS and this page is
  // already role-gated, so the caller's own session is the right client — the
  // policy stays the single access rule rather than being bypassed and
  // re-implemented here.
  const { data } = await supabase
    .from("sync_runs")
    .select("trigger_source, started_at, last_synced_at, status")
    .in("trigger_source", LAYER_IDS)
    .order("started_at", { ascending: false })
    .limit(500);

  const rows: SyncRunRow[] = data ?? [];
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

  const layers = Object.fromEntries(
    LAYER_IDS.map((id) => {
      const forLayer = rows.filter((row) => row.trigger_source === id);
      const succeeded = forLayer.filter(
        (row) => row.last_synced_at !== null && (row.status === "success" || row.status === "partial"),
      );
      return [
        id,
        {
          id,
          lastRunAt: forLayer[0]?.started_at ?? null,
          runsLast24h: forLayer.filter((row) => new Date(row.started_at).getTime() >= dayAgo).length,
          lastSuccessAt: succeeded[0]?.last_synced_at ?? null,
        } satisfies AutomationLayerStatus,
      ];
    }),
  ) as Record<AutomationLayerId, AutomationLayerStatus>;

  // Counts every trigger source including 'manual': an admin having synced by
  // hand means the pipeline works, which is a different problem from nothing
  // ever having run at all.
  const { count: anyRuns } = await supabase.from("sync_runs").select("id", { count: "exact", head: true });

  return { layers, neverSynced: (anyRuns ?? 0) === 0 };
}
