"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, RadioTower, RefreshCw } from "lucide-react";
import { triggerLiveScoresRefresh } from "@/app/admin/data-health/actions";

/**
 * A manual live-score refresh, in Admin.
 *
 * This action existed only as a staff control on `/live` — the fan-facing live
 * scores page. An operator forcing a refresh does not need to be standing on
 * the page a fan reads, and a fan reading that page should never have been
 * sharing it with a sync button.
 *
 * The action itself refuses when `FOOTBALL_LIVE_POLLING_ENABLED` is off, which
 * is the default and the only safe state on a free tier. That refusal is
 * stated here before the press rather than being discovered by pressing: the
 * button still works when the flag is on, and says why it will not when it is
 * off. It is never disabled on a guess — the server holds the flag, and the
 * server's answer is the one that counts.
 */
export function LiveRefreshButton({ enabled }: { enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  return (
    <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:items-end">
      <button
        type="button"
        disabled={pending || !enabled}
        aria-busy={pending}
        onClick={() => {
          if (pending || !enabled) return;
          setFeedback(null);
          startTransition(async () => {
            const result = await triggerLiveScoresRefresh();
            if (result.error) {
              setFeedback({ tone: "bad", text: result.error });
              return;
            }
            const count = result.recordsProcessed ?? 0;
            setFeedback({
              tone: "ok",
              text:
                count === 0
                  ? "Ran, and nothing had changed since the last refresh."
                  : `${count} fixture${count === 1 ? "" : "s"} updated.`,
            });
          });
        }}
        className="kivo-focusable flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent/15 px-4 text-sm font-semibold text-accent transition hover:bg-accent/25 disabled:opacity-50 sm:w-auto"
      >
        {pending ? (
          <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={1.75} />
        ) : (
          <RadioTower className="h-4 w-4" strokeWidth={1.75} />
        )}
        {pending ? "Refreshing" : "Refresh live scores"}
      </button>
      <p className="max-w-xs text-[11px] leading-relaxed text-foreground-subtle sm:text-right">
        {enabled
          ? "1 provider request. Same call as “Sync now” — one fixtures-by-date request that rewrites status, score and minute for everything in play."
          : "Refuses without spending anything: FOOTBALL_LIVE_POLLING_ENABLED is off, which is the default and the only safe state on a free tier."}
      </p>
      {feedback && (
        <p
          role="status"
          className={`flex max-w-xs items-start gap-1.5 text-[11px] leading-relaxed sm:justify-end sm:text-right ${
            feedback.tone === "bad" ? "text-critical" : "text-live"
          }`}
        >
          {feedback.tone === "bad" ? (
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2} />
          ) : (
            <Check className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2} />
          )}
          {feedback.text}
        </p>
      )}
    </div>
  );
}
