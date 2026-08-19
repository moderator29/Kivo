"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, ArrowLeftRight, Check, ListOrdered, RefreshCw } from "lucide-react";
import {
  triggerScopedStandingsSync,
  triggerTeamTransfersSync,
} from "@/app/admin/data-health/standings-transfers-actions";

/**
 * The two buttons that fill league tables and transfers.
 *
 * Both print what they spend on their own face, for the reason
 * catalogue-action-buttons.tsx sets out: the founder's account is on a free
 * tier of roughly a hundred requests a day, and a button whose price is in the
 * docs rather than on the button is a button that eats the day.
 */

type Feedback = { tone: "ok" | "bad"; lines: string[] } | null;

function FeedbackLine({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return (
    <div
      className={`flex items-start gap-1.5 text-xs ${feedback.tone === "bad" ? "text-critical" : "text-live"}`}
      role="status"
    >
      {feedback.tone === "bad" ? (
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      ) : (
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      )}
      <span className="flex flex-col gap-0.5">
        {feedback.lines.map((line, i) => (
          <span key={i}>{line}</span>
        ))}
      </span>
    </div>
  );
}

export function RefreshLeagueTablesButton({ limit }: { limit: number }) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={() => {
          if (pending) return;
          setFeedback(null);
          startTransition(async () => {
            const result = await triggerScopedStandingsSync();
            if (result.error) {
              setFeedback({ tone: "bad", lines: [result.error] });
              return;
            }
            const synced = result.outcomes.filter((o) => o.status === "synced");
            const failed = result.outcomes.filter((o) => o.status === "failed");
            const skipped = result.outcomes.filter((o) => o.status === "skipped");

            const lines: string[] = [];
            if (synced.length > 0) {
              lines.push(
                synced
                  .map((o) => `${o.competitionName}: ${o.status === "synced" ? o.rows : 0} rows`)
                  .join(" · "),
              );
            }
            // Every skip and every failure is named. A run that quietly reports
            // only its successes reads as "that's everything", which is the
            // single most misleading thing this panel could say.
            for (const outcome of failed) {
              if (outcome.status === "failed") lines.push(`${outcome.competitionName} failed: ${outcome.reason}`);
            }
            for (const outcome of skipped) {
              if (outcome.status === "skipped") lines.push(`${outcome.competitionName} skipped: ${outcome.reason}`);
            }
            if (lines.length === 0) lines.push("Nothing to refresh.");
            lines.push(`${result.requestsSpent} provider request(s) spent.`);

            setFeedback({ tone: failed.length > 0 ? "bad" : "ok", lines });
          });
        }}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-surface-1 px-4 py-2 text-sm font-semibold text-foreground-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
      >
        {pending ? (
          <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={1.75} />
        ) : (
          <ListOrdered className="h-4 w-4" strokeWidth={1.75} />
        )}
        {pending ? "Fetching tables…" : "Refresh league tables"}
      </button>
      <p className="text-[11px] text-foreground-subtle">
        Costs up to {limit} provider requests, one per table, in your configured competition order. Drawn from the same
        daily allowance the 05:00 sync uses — this is that job done early, not a second one. A table refreshed in the
        last six hours is skipped and says so.
      </p>
      <FeedbackLine feedback={feedback} />
    </div>
  );
}

export function SyncTeamTransfersButton({ teamId, teamName }: { teamId: string; teamName: string }) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        aria-label={`Sync transfers for ${teamName}`}
        onClick={() => {
          if (pending) return;
          setFeedback(null);
          startTransition(async () => {
            const result = await triggerTeamTransfersSync(teamId);
            setFeedback(
              result.error
                ? { tone: "bad", lines: [result.error] }
                : { tone: "ok", lines: [`${result.recordsProcessed} transfer(s) stored.`] },
            );
          });
        }}
        className="flex items-center gap-1.5 rounded-lg bg-surface-1 px-3 py-1.5 text-xs font-semibold text-foreground-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
      >
        {pending ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        ) : (
          <ArrowLeftRight className="h-3.5 w-3.5" strokeWidth={2} />
        )}
        {pending ? "Fetching…" : "1 request"}
      </button>
      <FeedbackLine feedback={feedback} />
    </div>
  );
}
