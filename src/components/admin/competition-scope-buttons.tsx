"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, Minus, Plus, RefreshCw } from "lucide-react";
import { addCompetitionToScope, removeCompetitionFromScope } from "@/app/admin/data-health/scope-actions";

/**
 * One competition, in or out.
 *
 * No cost line on this one, and its absence is the point: both actions read a
 * registry KIVO has already paid for and spend nothing. The buttons that DO
 * spend are labelled with their price (see catalogue-action-buttons.tsx); a
 * price on a free action would make that signal meaningless.
 */
export function ScopeToggleButton({
  providerCompetitionId,
  name,
  inScope,
}: {
  providerCompetitionId: string;
  name: string;
  inScope: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        aria-label={inScope ? `Stop covering ${name}` : `Cover ${name}`}
        onClick={() => {
          if (pending) return;
          setError(null);
          startTransition(async () => {
            const result = inScope
              ? await removeCompetitionFromScope(providerCompetitionId)
              : await addCompetitionToScope(providerCompetitionId);
            setError(result.error);
          });
        }}
        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50 ${
          inScope
            ? "bg-accent/15 text-accent hover:bg-accent/25"
            : "bg-surface-1 text-foreground-muted hover:bg-surface-2"
        }`}
      >
        {pending ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        ) : inScope ? (
          <Check className="h-3.5 w-3.5" strokeWidth={2} />
        ) : (
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
        )}
        {inScope ? "Covered" : "Cover"}
        {inScope && !pending && <Minus className="h-3 w-3 opacity-60" strokeWidth={2} />}
      </button>
      {error && (
        <span className="flex max-w-[16rem] items-start gap-1 text-right text-[11px] text-critical" role="status">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2} />
          {error}
        </span>
      )}
    </span>
  );
}
