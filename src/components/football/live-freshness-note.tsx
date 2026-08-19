import { CircleAlert } from "lucide-react";
import { LastSyncedNote } from "@/components/football/last-synced-note";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { FOOTBALL_LIVE_POLLING_ENABLED, getActiveProviderStatus } from "@/lib/football";
import { getLastSyncedAt } from "@/lib/football/last-synced";
import { readBudgetUsage } from "@/lib/football/request-budget";
import { logError } from "@/lib/log";

/**
 * One honest line about how current the scores on this page actually are.
 *
 * A product whose front page is called Live has to be able to say when it is
 * not. There are three genuinely different states, and a frozen number looks
 * identical in all of them:
 *
 *   * **Live polling is on and within budget.** Scores refresh on their own,
 *     at a pace the worker derives. Only the freshness timestamp is needed.
 *   * **The automatic allowance is used up.** Refreshes have paused until some
 *     of it frees up. The number on screen is the last one KIVO fetched, and
 *     saying so is the difference between a stale score and a lie.
 *   * **Live polling is off.** Scores only move when somebody opens a football
 *     page and the data is already stale. That is the default, and a fan
 *     deserves to know it rather than infer it from a score that never changes.
 *
 * Deliberately built on `LastSyncedNote` rather than as a second freshness
 * vocabulary. The timestamp is the same fact every other football surface
 * shows; this only adds the sentence that explains what will happen next.
 */
export async function LiveFreshnessNote({ className = "" }: { className?: string }) {
  const { name: providerName } = getActiveProviderStatus();
  const lastSyncedAt = await getLastSyncedAt(["fixture"]);

  if (!providerName) {
    return (
      <span className={`text-[11px] leading-relaxed text-foreground-subtle ${className}`}>
        No data source is connected on this deployment, so nothing here updates on its own.
      </span>
    );
  }

  let exhausted = false;
  try {
    const usage = await readBudgetUsage(createServiceRoleSupabaseClient(), providerName);
    const live = usage.find((entry) => entry.bucket === "live");
    exhausted = live !== undefined && live.spentInWindow >= live.limit;
  } catch (error) {
    // A page must not fail because the ledger could not be read, and it must
    // not claim scores are refreshing when it does not know. Falling through to
    // the plain timestamp says only what is certain: when KIVO last updated.
    logError("football.liveFreshness.readBudget", error);
  }

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <LastSyncedNote timestamp={lastSyncedAt} />
      {exhausted ? (
        <span className="flex items-start gap-1.5 text-[11px] leading-relaxed text-warning">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          Automatic refreshes have paused — today&apos;s update allowance is used up, so these scores may be behind the
          real ones until it frees up.
        </span>
      ) : !FOOTBALL_LIVE_POLLING_ENABLED ? (
        <span className="text-[11px] leading-relaxed text-foreground-subtle">
          Scores refresh when a football page is opened and the data is already stale, not continuously — so a match in
          progress may be behind.
        </span>
      ) : null}
    </div>
  );
}
