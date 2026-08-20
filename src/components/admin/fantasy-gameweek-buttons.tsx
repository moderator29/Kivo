"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, CalendarPlus, Check, RefreshCw } from "lucide-react";
import { generateFantasyGameweeks } from "@/app/admin/football/fantasy-actions";

/**
 * Deriving one season's fantasy gameweeks.
 *
 * Costs no provider quota: it reads fixtures KIVO already holds and writes
 * gameweek rows from them. That is stated on the button for the same reason
 * every expensive one states its price — an operator who assumes everything
 * here spends the day's allowance will not press the ones that spend nothing.
 */
export function GenerateGameweeksButton({
  seasonId,
  hasFixtures,
  hasGameweeks,
}: {
  seasonId: string;
  hasFixtures: boolean;
  hasGameweeks: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  return (
    <div className="flex w-full flex-col gap-1 sm:w-auto sm:items-end">
      <button
        type="button"
        disabled={pending || !hasFixtures}
        aria-busy={pending}
        title={hasFixtures ? undefined : "This season has no synced fixtures to derive gameweeks from"}
        onClick={() => {
          if (pending || !hasFixtures) return;
          setFeedback(null);
          startTransition(async () => {
            const result = await generateFantasyGameweeks(seasonId);
            if (result.error) {
              setFeedback({ tone: "bad", text: result.error });
              return;
            }
            const count = result.recordsProcessed ?? 0;
            setFeedback({
              tone: "ok",
              text:
                count === 0
                  ? "Ran, and every gameweek this season's fixtures imply already existed."
                  : `${count} gameweek${count === 1 ? "" : "s"} created.`,
            });
          });
        }}
        className="kivo-focusable flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-surface-2 px-3 text-xs font-semibold text-foreground-muted transition hover:bg-surface-1 disabled:opacity-50 sm:w-auto"
      >
        {pending ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        ) : (
          <CalendarPlus className="h-3.5 w-3.5" strokeWidth={2} />
        )}
        {pending ? "Generating" : hasGameweeks ? "Fill any missing" : "Generate"}
      </button>
      <p className="text-[11px] text-foreground-subtle sm:text-right">
        {hasFixtures ? "Free — no provider request" : "Nothing to derive from yet"}
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
