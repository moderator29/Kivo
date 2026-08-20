"use client";

import { useState, useTransition, type ReactNode } from "react";
import { AlertTriangle, Check, HeartPulse, RefreshCw, Target } from "lucide-react";
import {
  reconcileCoverage,
  reconcileSeasonStatistics,
  triggerInjuriesSync,
  triggerTopScorersSync,
} from "@/app/admin/football/provider-data-actions";

/**
 * The per-competition season-data buttons, in Admin.
 *
 * These four actions previously existed only as staff controls rendered inside
 * the product — on a league page, a player page, a club page — behind a role
 * check. The gating was correct and never the problem. The problem was that
 * football data operations were scattered across the surfaces a fan reads, so
 * running them meant navigating the product as an operator, and reviewing the
 * product meant reading past operator tooling. FOOTBALL FIRST, DATA SECOND,
 * TECHNOLOGY INVISIBLE: this is where technology goes.
 *
 * Every button states its price before it is pressed, in the same shape
 * `catalogue-action-buttons.tsx` established. Two of these cost nothing, and
 * saying so just as loudly matters — an operator who assumes every button is
 * expensive will not press the free ones.
 */

type Feedback = { tone: "ok" | "bad"; text: string } | null;

function ActionButton({
  icon,
  label,
  busyLabel,
  cost,
  disabled,
  disabledReason,
  compact = false,
  onRun,
}: {
  icon: ReactNode;
  label: string;
  busyLabel: string;
  /** What pressing this spends, always stated, including when it is nothing. */
  cost: string;
  disabled?: boolean;
  disabledReason?: string;
  compact?: boolean;
  onRun: () => Promise<Feedback>;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);

  return (
    <div className={compact ? "flex w-full flex-col gap-1 sm:w-auto sm:items-end" : "flex flex-col gap-1.5"}>
      <button
        type="button"
        disabled={pending || disabled}
        aria-busy={pending}
        title={disabled ? disabledReason : undefined}
        onClick={() => {
          if (pending || disabled) return;
          setFeedback(null);
          startTransition(async () => setFeedback(await onRun()));
        }}
        className={`kivo-focusable flex min-h-11 items-center justify-center gap-2 rounded-lg bg-surface-1 px-3 text-xs font-semibold text-foreground-muted transition hover:bg-surface-2 disabled:opacity-50 ${
          compact ? "w-full sm:w-auto" : "w-full px-4 text-sm"
        }`}
      >
        {pending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : icon}
        {pending ? busyLabel : label}
      </button>
      <p className={`text-[11px] text-foreground-subtle ${compact ? "sm:text-right" : ""}`}>
        {disabled && disabledReason ? disabledReason : cost}
      </p>
      {feedback && (
        <p
          role="status"
          className={`flex items-start gap-1.5 text-[11px] ${feedback.tone === "bad" ? "text-critical" : "text-live"}`}
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

function describe(result: { error: string | null; recordsProcessed?: number }, noun: string): Feedback {
  if (result.error) return { tone: "bad", text: result.error };
  const count = result.recordsProcessed ?? 0;
  return {
    tone: "ok",
    text: count === 0 ? `Ran, and the provider returned no ${noun}.` : `${count} ${noun} written.`,
  };
}

export function SyncInjuriesButton({
  competitionId,
  supported,
}: {
  competitionId: string;
  /** The provider's own registry answer for this competition: true, false, or
   * null when the registry has never been read. A definite `false` disables the
   * button rather than spending a request to be told no again. */
  supported: boolean | null;
}) {
  return (
    <ActionButton
      compact
      icon={<HeartPulse className="h-3.5 w-3.5" strokeWidth={2} />}
      label="Absences"
      busyLabel="Syncing"
      cost="1 provider request"
      disabled={supported === false}
      disabledReason={supported === false ? "The provider's registry says this competition publishes none" : undefined}
      onRun={async () => describe(await triggerInjuriesSync(competitionId), "absence reports")}
    />
  );
}

export function SyncTopScorersButton({
  competitionId,
  supported,
}: {
  competitionId: string;
  supported: boolean | null;
}) {
  return (
    <ActionButton
      compact
      icon={<Target className="h-3.5 w-3.5" strokeWidth={2} />}
      label="Scorers"
      busyLabel="Syncing"
      cost="1 provider request"
      disabled={supported === false}
      disabledReason={supported === false ? "The provider's registry says this competition publishes none" : undefined}
      onRun={async () => describe(await triggerTopScorersSync(competitionId), "chart rows")}
    />
  );
}

export function ReconcileCoverageButton() {
  return (
    <ActionButton
      icon={<RefreshCw className="h-4 w-4" strokeWidth={1.75} />}
      label="Link coverage rows to competitions"
      busyLabel="Linking"
      cost="Free — no provider request. Links registry rows to competitions synced since the registry was read."
      onRun={async () => describe(await reconcileCoverage(), "rows")}
    />
  );
}

export function ReconcileSeasonStatisticsButton() {
  return (
    <ActionButton
      icon={<RefreshCw className="h-4 w-4" strokeWidth={1.75} />}
      label="Link season statistics to competitions"
      busyLabel="Linking"
      cost="Free — no provider request. Links stored season-statistics rows to competitions synced since."
      onRun={async () => describe(await reconcileSeasonStatistics(), "rows")}
    />
  );
}
