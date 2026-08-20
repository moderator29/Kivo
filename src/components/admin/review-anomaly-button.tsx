"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { markAnomalyReviewed } from "@/app/admin/football/actions";

/**
 * Marks one detected data conflict as looked at (KN-95).
 *
 * "Reviewed" means a person saw it, and nothing more — it does not correct the
 * data, and it deliberately cannot: KIVO has one football data source, so
 * there is no second reading to arbitrate against. The row stays in the table
 * with who reviewed it and when, so the history of what was noticed survives.
 */
export function ReviewAnomalyButton({ anomalyId }: { anomalyId: string }) {
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (reviewed) {
    return <span className="shrink-0 text-[11px] font-medium text-live">Reviewed</span>;
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await markAnomalyReviewed(anomalyId);
            if (result.error) setError(result.error);
            else setReviewed(true);
          })
        }
        className="kivo-glass-sharp flex min-h-11 items-center gap-1 rounded-lg px-3 text-[11px] font-semibold text-foreground transition-transform active:scale-95 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <Check className="h-3 w-3" strokeWidth={2} />
        {pending ? "Saving…" : "Mark reviewed"}
      </button>
      {error && <span className="text-[11px] text-critical">{error}</span>}
    </div>
  );
}
