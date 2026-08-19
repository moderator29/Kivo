"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, ChartColumn, Check, RefreshCw } from "lucide-react";
import { triggerPlayerSeasonStatisticsSync } from "@/app/admin/data-health/provider-data-actions";

/**
 * One player's season statistics. One provider request, said before the press —
 * see `catalogue-action-buttons.tsx` for why every button in Admin carries its
 * own price.
 */
export function SyncPlayerSeasonStatisticsButton({
  playerId,
  playerName,
  hasStats,
}: {
  playerId: string;
  playerName: string;
  hasStats: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  return (
    <div className="flex w-full flex-col gap-1 sm:w-auto sm:items-end">
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={() => {
          if (pending) return;
          setFeedback(null);
          startTransition(async () => {
            const result = await triggerPlayerSeasonStatisticsSync(playerId);
            if (result.error) {
              setFeedback({ tone: "bad", text: result.error });
              return;
            }
            const count = result.recordsProcessed ?? 0;
            setFeedback({
              tone: "ok",
              text:
                count === 0
                  ? `Ran, and the provider returned no breakdown for ${playerName}.`
                  : `${count} row${count === 1 ? "" : "s"} written for ${playerName}.`,
            });
          });
        }}
        className="kivo-focusable flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-surface-1 px-3 text-xs font-semibold text-foreground-muted transition hover:bg-surface-2 disabled:opacity-50 sm:w-auto"
      >
        {pending ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        ) : (
          <ChartColumn className="h-3.5 w-3.5" strokeWidth={2} />
        )}
        {pending ? "Syncing" : hasStats ? "Refresh" : "Sync"}
      </button>
      <p className="text-[11px] text-foreground-subtle sm:text-right">1 provider request</p>
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
