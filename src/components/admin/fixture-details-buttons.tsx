"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, RefreshCw, ClipboardList } from "lucide-react";
import { triggerFixtureDetailsSync } from "@/app/admin/football/actions";

/**
 * One fixture's line-ups, events and statistics, on demand.
 *
 * ## Why this exists again
 *
 * This capability used to live on the public match page as
 * `FixtureDetailsSyncControl` — role-gated, but rendered inside the product,
 * which RECOMMENDATIONS F2 is about. The 2026-08-19 pass removed it from there
 * and F6 recorded the follow-up as "move it into /admin entirely". The removal
 * happened; the move did not. `triggerFixtureDetailsSync` was left with **no
 * caller anywhere in the codebase**, which is precisely the failure A5 named:
 * "a control removed before its replacement exists is a capability deleted."
 * Meanwhile the Provider page's own sync-order checklist still told the
 * operator step 5 lived on "that fixture's Match Centre", where nothing had
 * been for a day. This is the replacement.
 *
 * ## The cost, on the button, before it is pressed
 *
 * Three provider requests: line-ups, events and statistics are three separate
 * endpoints in `syncFixtureDetails`. The squad opt-in is a checkbox rather than
 * a default because it costs two more per team the provider has never served —
 * RECOMMENDATIONS item 59, and the same rule
 * `catalogue-action-buttons.tsx` states: a quota-spending action says its price
 * on its own face.
 */
export function SyncFixtureDetailsButton({
  fixtureId,
  label,
  hasDetails,
}: {
  fixtureId: string;
  /** "Arsenal v Chelsea" — used in the feedback line so a list of these does not
   *  report success without saying which row it belongs to. */
  label: string;
  hasDetails: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [autoSquads, setAutoSquads] = useState(false);
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
            const result = await triggerFixtureDetailsSync(fixtureId, autoSquads);
            if (result.error) {
              setFeedback({ tone: "bad", text: result.error });
              return;
            }
            const count = result.recordsProcessed ?? 0;
            setFeedback({
              tone: "ok",
              text:
                count === 0
                  ? `Ran, and the provider returned nothing for ${label}. Not a failure — some competitions publish no line-ups at all.`
                  : `${count} record${count === 1 ? "" : "s"} written for ${label}.`,
            });
          });
        }}
        className="kivo-focusable flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent/15 px-4 text-xs font-semibold text-accent transition hover:bg-accent/25 disabled:opacity-50 sm:w-auto"
      >
        {pending ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        ) : (
          <ClipboardList className="h-3.5 w-3.5" strokeWidth={2} />
        )}
        {pending ? "Syncing" : hasDetails ? "Refresh details" : "Sync details"}
      </button>

      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[11px] text-foreground-subtle sm:justify-end">
        <input
          type="checkbox"
          checked={autoSquads}
          onChange={(event) => setAutoSquads(event.target.checked)}
          className="h-4 w-4 rounded border-hairline accent-accent"
        />
        Also sync any squad this fixture needs (+2 requests per unseen club)
      </label>

      <p className="text-[11px] text-foreground-subtle sm:text-right">
        3 provider requests — line-ups, events and statistics are separate endpoints.
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
