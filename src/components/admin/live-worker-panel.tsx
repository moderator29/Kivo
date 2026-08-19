import { Activity, CircleAlert, CirclePause, Gauge, Radio } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { LocalDateTime } from "@/components/ui/relative-time";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { FOOTBALL_LIVE_POLLING_ENABLED, getActiveProviderStatus } from "@/lib/football";
import { readBudgetUsage, TOTAL_AUTOMATED_REQUEST_BUDGET, type BucketUsage } from "@/lib/football/request-budget";

/**
 * What the live worker is actually doing, right now.
 *
 * Built because a background job whose state nobody can see is a job that has
 * silently been dead for a week — and this project has already had two features
 * that were built, documented, deployed and never ran. The existing
 * `AutomationStatusPanel` answers "has this layer ever run at all"; this answers
 * the narrower operational question that only matters once it has: how much of
 * the account's quota automation has spent, on what, and why it is idle at this
 * exact moment.
 *
 * Every number here is read from real rows — the `provider_request_spend`
 * ledger (migration 0091) and the worker's own `sync_runs` decisions. Nothing
 * is estimated, and an unreadable ledger deliberately reports as fully spent
 * rather than as empty: "nothing has been spent" is the one wrong answer that
 * would make somebody turn the flag on.
 */

const BUCKET_COPY: Record<BucketUsage["bucket"], { label: string; detail: string }> = {
  live: {
    label: "Live worker",
    detail: "Refreshes in-play scores. Paced across the day's football rather than on a fixed interval.",
  },
  auto: {
    label: "On-demand freshness",
    detail: "Spent when somebody opens a football page and the data is already stale.",
  },
  daily: {
    label: "Daily baseline",
    detail: "One fixtures call plus a few league tables, so the database is never empty.",
  },
};

/** The plain-English reasons the worker records, mapped to what an admin should
 * take from each. Matched on the prefix the planner writes, so a reason the
 * planner adds later degrades to showing its own sentence rather than being
 * silently mislabelled. */
function readIdleReason(message: string | null): { tone: "normal" | "attention"; summary: string } | null {
  if (!message) return null;
  const text = message.replace(/^Skipped:\s*/i, "");
  if (/^Nothing is in play/i.test(text)) {
    return { tone: "normal", summary: "Idle because nothing is in play. This costs nothing and is the usual state." };
  }
  if (/^Last refresh was/i.test(text)) {
    return { tone: "normal", summary: text };
  }
  if (/allowance/i.test(text)) {
    return { tone: "attention", summary: text };
  }
  if (/FOOTBALL_LIVE_POLLING_ENABLED/i.test(text)) {
    return { tone: "attention", summary: "Live polling is switched off, so the worker never spends anything." };
  }
  return { tone: "attention", summary: text };
}

export async function LiveWorkerPanel() {
  const { name: providerName, label: providerLabel } = getActiveProviderStatus();

  if (!providerName) {
    return (
      <FadeIn className="kivo-glass flex flex-col gap-2 rounded-2xl p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <Radio className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Live worker
        </h2>
        <p className="text-sm text-foreground-muted">
          No football data source is configured on this deployment, so there is no quota to budget and nothing for the
          worker to spend.
        </p>
      </FadeIn>
    );
  }

  const supabase = createServiceRoleSupabaseClient();

  const [usage, lastCronRun] = await Promise.all([
    readBudgetUsage(supabase, providerName),
    supabase
      .from("sync_runs")
      .select("status, started_at, error_message, records_processed, provider_quota_remaining")
      .eq("trigger_source", "cron")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const last = lastCronRun.data ?? null;
  const idle = last?.status === "skipped" ? readIdleReason(last.error_message) : null;
  const totalSpent = usage.reduce((sum, entry) => sum + entry.spentInWindow, 0);

  return (
    <FadeIn className="kivo-glass flex flex-col gap-4 rounded-2xl p-5">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <Radio className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Live worker
        </h2>
        <p className="text-[11px] leading-relaxed text-foreground-subtle">
          Spend over a rolling 24 hours, from the request ledger. A rolling window rather than a calendar day because
          KIVO can&apos;t establish when {providerLabel}&apos;s own allowance resets — a trailing cap holds under every
          possible reset time.
        </p>
      </div>

      {/* The flag, stated first, because every other number on this panel means
          something different depending on it. */}
      <div
        className={`flex items-start gap-2.5 rounded-xl border p-3 ${
          FOOTBALL_LIVE_POLLING_ENABLED ? "border-hairline bg-surface-1" : "border-hairline bg-surface-2"
        }`}
      >
        {FOOTBALL_LIVE_POLLING_ENABLED ? (
          <Activity className="mt-0.5 h-4 w-4 shrink-0 text-live" strokeWidth={1.75} />
        ) : (
          <CirclePause className="mt-0.5 h-4 w-4 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
        )}
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">
            {FOOTBALL_LIVE_POLLING_ENABLED ? "Live polling is on" : "Live polling is off"}
          </span>
          <span className="text-[11px] leading-relaxed text-foreground-subtle">
            {FOOTBALL_LIVE_POLLING_ENABLED
              ? `The worker may spend up to ${usage.find((u) => u.bucket === "live")?.limit ?? 0} requests in any 24 hours, and nothing at all when no match is in play.`
              : `Every firing is a same-millisecond no-op that spends nothing. Turning it on costs at most ${usage.find((u) => u.bucket === "live")?.limit ?? 0} requests in any 24 hours — see ENVIRONMENT.md.`}
          </span>
        </div>
      </div>

      <ul className="flex flex-col gap-3">
        {usage.map((entry) => {
          const copy = BUCKET_COPY[entry.bucket];
          const pct = entry.limit > 0 ? Math.min(100, (entry.spentInWindow / entry.limit) * 100) : 0;
          const exhausted = entry.spentInWindow >= entry.limit;
          return (
            <li key={entry.bucket} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-foreground">{copy.label}</span>
                <span
                  className={`text-xs font-semibold tabular-nums ${exhausted ? "text-warning" : "text-foreground-muted"}`}
                >
                  {entry.spentInWindow} / {entry.limit}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-track">
                <div
                  className={`h-full rounded-full ${exhausted ? "bg-warning" : "bg-accent"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-[11px] leading-relaxed text-foreground-subtle">
                {copy.detail}
                {entry.lastSpendAt && (
                  <>
                    {" Last spend "}
                    <LocalDateTime iso={entry.lastSpendAt} format="dayTime" />.
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-1 border-t border-hairline-soft pt-3">
        <div className="flex items-center gap-2">
          <Gauge className="h-3.5 w-3.5 text-foreground-subtle" strokeWidth={2} />
          <span className="text-[11px] text-foreground-subtle">
            {totalSpent} of {TOTAL_AUTOMATED_REQUEST_BUDGET} automated requests used in the last 24 hours. Anything
            beyond that is reserved for admin-triggered syncs and cannot be spent by automation.
          </span>
        </div>
        {last?.provider_quota_remaining !== null && last?.provider_quota_remaining !== undefined && (
          <span className="pl-5 text-[11px] text-foreground-subtle">
            {providerLabel} last reported {last.provider_quota_remaining} requests remaining on its own count.
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1 border-t border-hairline-soft pt-3">
        {last ? (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
                Last decision
              </span>
              <span className="text-[11px] text-foreground-subtle">
                <LocalDateTime iso={last.started_at} format="dayTime" />
              </span>
            </div>
            {idle ? (
              <span
                className={`flex items-start gap-1.5 text-[11px] leading-relaxed ${
                  idle.tone === "attention" ? "text-warning" : "text-foreground-subtle"
                }`}
              >
                {idle.tone === "attention" && <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
                {idle.summary}
              </span>
            ) : (
              <span className="text-[11px] leading-relaxed text-foreground-subtle">
                {last.status === "skipped"
                  ? (last.error_message ?? "Skipped, with no reason recorded.")
                  : `Refreshed ${last.records_processed ?? 0} fixture${last.records_processed === 1 ? "" : "s"} (${last.status}).`}
              </span>
            )}
          </>
        ) : (
          // The distinction that matters most on this panel: never having run is
          // not the same as running and deciding to do nothing.
          <span className="text-[11px] leading-relaxed text-foreground-subtle">
            The live worker has never run on this deployment. That is a scheduler that is not firing, not a worker that
            is idle — see the automation panel above for the exact remaining step.
          </span>
        )}
      </div>
    </FadeIn>
  );
}
