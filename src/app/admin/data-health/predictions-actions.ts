"use server";

import { revalidatePath } from "next/cache";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { settlePredictions } from "@/lib/prediction-settlement";
import { logError } from "@/lib/log";

/**
 * The admin-triggered settlement pass.
 *
 * The engine itself is `settlePredictions` (`src/lib/prediction-settlement.ts`)
 * and this is now one of two callers rather than the only door — the daily
 * scheduled sync runs the same function unconditionally, which is what stops a
 * deployed KIVO leaving a correct call unscored forever. What is left here is
 * exactly the part a scheduler cannot have: an authenticated admin, an audit
 * row naming who ran it, and cache invalidation for the pages that show the
 * result.
 *
 * Kept as a button on purpose even though the schedule now covers it. An admin
 * who has just corrected a final score, or who has just synced a fixture's
 * events by hand, should not have to wait until tomorrow to see the predictions
 * resettle against what they fixed.
 */
export async function scorePredictions(): Promise<{
  error: string | null;
  recordsProcessed?: number;
  /** Rows this pass genuinely could not settle. Surfaced rather than hidden,
   * because "nothing happened" and "forty rows are waiting on a details sync"
   * look identical from a single count. */
  unresolvedCount?: number;
  /** Rows that had already been settled and now say something different. XP is
   * reconciled for each, so this number is also "how many people's totals
   * moved". */
  adjustedCount?: number;
}> {
  const profile = await getOrCreateProfile();
  if (!profile || !canManageFootballData(profile.role)) {
    return { error: "You don't have football data admin access." };
  }

  // Service-role because this writes points onto other users' rows, which
  // `predictions_update_own_unlocked` (correctly) never allows a plain client
  // to do.
  const service = createServiceRoleSupabaseClient();

  let result;
  try {
    result = await settlePredictions(service);
  } catch (error) {
    logError("admin.data-health.predictions-actions.scorePredictions", error);
    return { error: "Couldn't settle predictions. Try again." };
  }

  await logAudit(profile.id, "score_predictions", "predictions", {
    fixturesConsidered: result.fixturesConsidered,
    recordsProcessed: result.settled,
    unresolvedCount: result.unresolved,
    adjustedCount: result.adjusted,
  });

  revalidatePath("/predictions");
  revalidatePath("/admin/data-health");
  revalidatePath("/rewards");

  return {
    error: null,
    recordsProcessed: result.settled,
    unresolvedCount: result.unresolved,
    adjustedCount: result.adjusted,
  };
}
