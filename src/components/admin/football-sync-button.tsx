"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Check, AlertTriangle, CalendarDays } from "lucide-react";
import { triggerFootballSync } from "@/app/admin/data-health/actions";

/** Local `YYYY-MM-DD` for the date input's default and its "today" comparison.
 * Deliberately the UTC day, matching the boundary `syncTodayFixtures` and the
 * `/matches` date strip both already use — an admin picking "today" here must
 * get the same day the pipeline means by it. */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * KIVO_NEXT_GEN KN-31. The date field is what turns `/matches`' seven-day strip
 * from a promise into something reachable: before this, `syncTodayFixtures` only
 * ever asked the provider for today, so every other day the strip offered was
 * structurally guaranteed to stay empty forever.
 *
 * Collapsed by default and the button keeps working untouched, because the
 * overwhelmingly common action is still "sync today". Opening the field is the
 * deliberate act — and it should be, since each run spends real provider quota
 * against a free tier.
 */
export function FootballSyncButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error: string | null; recordsProcessed?: number } | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [date, setDate] = useState(todayKey());

  const isToday = date === todayKey();

  function handleClick() {
    if (pending) return;
    setResult(null);
    startTransition(async () => {
      const outcome = await triggerFootballSync(dateOpen && !isToday ? date : undefined);
      setResult(outcome);
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {dateOpen && (
          <label className="flex items-center gap-1.5 text-xs text-foreground-muted">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">Date to sync</span>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="rounded-lg border border-hairline bg-surface-inset px-2 py-1.5 text-xs text-foreground focus:border-accent focus:outline-none"
            />
          </label>
        )}
        <button
          type="button"
          onClick={() => {
            setDateOpen((open) => !open);
            setDate(todayKey());
            setResult(null);
          }}
          aria-pressed={dateOpen}
          className="rounded-lg px-2 py-1.5 text-xs font-medium text-foreground-subtle transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {dateOpen ? "Cancel" : "Pick a date"}
        </button>
      </div>

      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={handleClick}
        className="flex items-center gap-2 rounded-lg bg-accent/15 px-4 py-2 text-sm font-semibold text-accent transition hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
      >
        <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} strokeWidth={2} />
        {pending ? "Syncing…" : dateOpen && !isToday ? `Sync ${date}` : "Sync now"}
      </button>

      {result && (
        <p
          className={`flex items-center gap-1.5 text-xs ${result.error ? "text-critical" : "text-live"}`}
          role="status"
        >
          {result.error ? (
            <>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              {result.error}
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              Synced {result.recordsProcessed ?? 0} fixture{result.recordsProcessed === 1 ? "" : "s"}
            </>
          )}
        </p>
      )}
    </div>
  );
}
