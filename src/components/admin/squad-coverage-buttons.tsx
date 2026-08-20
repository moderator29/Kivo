"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, RefreshCw, Users } from "lucide-react";
import { triggerTeamSquadSync } from "@/app/admin/football/actions";

/**
 * One club's squad, on demand.
 *
 * Two provider requests, because the squad and the manager are separate
 * endpoints — the same number `runSquadBackfill` reserves per club, said here
 * before the button is pressed rather than in the docs. See
 * `catalogue-action-buttons.tsx` for why every button on this page states its
 * price on its own face.
 */
export function SyncClubSquadButton({
  teamId,
  teamName,
  /** Changes the verb only. Re-running a club that already has a squad is a
   * refresh, and calling it "Sync" implies work that has not been done. */
  hasSquad,
}: {
  teamId: string;
  teamName: string;
  hasSquad: boolean;
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
            const result = await triggerTeamSquadSync(teamId);
            if (result.error) {
              setFeedback({ tone: "bad", text: result.error });
              return;
            }
            const count = result.recordsProcessed ?? 0;
            setFeedback({
              tone: "ok",
              text:
                count === 0
                  ? `Ran, and the provider returned no squad for ${teamName}.`
                  : `${count} record${count === 1 ? "" : "s"} written for ${teamName}.`,
            });
          });
        }}
        className="kivo-focusable flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent/15 px-4 text-xs font-semibold text-accent transition hover:bg-accent/25 disabled:opacity-50 sm:w-auto"
      >
        {pending ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        ) : (
          <Users className="h-3.5 w-3.5" strokeWidth={2} />
        )}
        {pending ? "Syncing" : hasSquad ? "Refresh squad" : "Sync squad"}
      </button>
      <p className="text-[11px] text-foreground-subtle sm:text-right">
        2 provider requests — squad and manager are separate endpoints.
      </p>
      {feedback && (
        <p
          role="status"
          className={`flex items-start gap-1.5 text-[11px] sm:justify-end sm:text-right ${
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
