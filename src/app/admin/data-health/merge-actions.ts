"use server";

import { revalidatePath } from "next/cache";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { logError } from "@/lib/log";
import type { Json } from "@/lib/supabase/types";

/**
 * KIVO_NEXT_GEN KN-83. The admin half of the team merge.
 *
 * Two actions rather than one, and the split is the safety property: nothing
 * can merge without a preview having been rendered first, because the confirm
 * action is a separate deliberate call. The database function defaults to a dry
 * run for the same reason — belt and braces on the most destructive operation
 * in this schema.
 */

export type TeamMergeReport = {
  ok: boolean;
  dryRun: boolean;
  survivorName: string | null;
  mergedName: string | null;
  blockers: string[];
  counts: Record<string, number>;
};

function parseReport(payload: unknown): TeamMergeReport | null {
  if (typeof payload !== "object" || payload === null) return null;
  const raw = payload as Record<string, unknown>;
  const survivor = raw.survivor as Record<string, unknown> | null;
  const merged = raw.merged as Record<string, unknown> | null;
  const counts = (raw.would_move ?? raw.moved) as Record<string, unknown> | undefined;

  return {
    ok: raw.ok === true,
    dryRun: raw.dry_run === true,
    survivorName: typeof survivor?.name === "string" ? survivor.name : null,
    mergedName: typeof merged?.name === "string" ? merged.name : null,
    blockers: Array.isArray(raw.blockers) ? raw.blockers.filter((b): b is string => typeof b === "string") : [],
    counts: Object.fromEntries(
      Object.entries(counts ?? {})
        .filter(([, value]) => typeof value === "number")
        .map(([key, value]) => [key, value as number]),
    ),
  };
}

async function runMerge(
  survivorId: string,
  mergedId: string,
  dryRun: boolean,
): Promise<{ error: string | null; report: TeamMergeReport | null }> {
  const profile = await getOrCreateProfile();
  if (!profile || !canManageFootballData(profile.role)) {
    return { error: "You don't have football data admin access.", report: null };
  }

  // The service-role client is required because merge_teams is granted to
  // service_role only — but the function *also* re-checks the caller's role
  // internally, which is why the role check above is a message rather than the
  // boundary. Two independent checks on the one operation that can delete a
  // club and rewrite every row pointing at it.
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.rpc("merge_teams", {
    p_survivor_id: survivorId,
    p_merged_id: mergedId,
    p_dry_run: dryRun,
  });

  if (error) {
    logError("admin.mergeTeams", error, { survivorId, mergedId, dryRun });
    return { error: error.message, report: null };
  }

  const report = parseReport(data);
  if (!report) return { error: "The merge returned an unreadable result.", report: null };

  if (!dryRun && report.ok) {
    await logAudit(profile.id, "team.merged", "team", {
      survivor_id: survivorId,
      merged_id: mergedId,
      counts: report.counts as unknown as Json,
    });
    revalidatePath("/admin/data-health");
    revalidatePath("/teams");
  }

  return { error: null, report };
}

/** Changes nothing. Returns what a real merge would do, and what would block it. */
export async function previewTeamMerge(survivorId: string, mergedId: string) {
  return runMerge(survivorId, mergedId, true);
}

/** Irreversible. Only ever called after a preview has been shown. */
export async function confirmTeamMerge(survivorId: string, mergedId: string) {
  return runMerge(survivorId, mergedId, false);
}
