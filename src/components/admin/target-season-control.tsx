"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, RefreshCw, RotateCcw } from "lucide-react";
import { setTargetSeason, clearTargetSeason } from "@/app/admin/data-health/season-actions";

/**
 * The number that unblocks the platform.
 *
 * Costs 0 provider requests — it changes which season the next sync asks for,
 * it does not ask for anything itself. Deliberately shows the suggested year
 * as a preset button when the provider has named a range in a refusal, so the
 * operator is choosing a year the provider itself said it can serve rather
 * than typing one and hoping.
 */
export function TargetSeasonControl({
  currentSeasonYear,
  calendarSeasonYear,
  isOverride,
  suggestedYear,
}: {
  currentSeasonYear: number;
  calendarSeasonYear: number;
  isOverride: boolean;
  /** A year inside the window the provider named in its own refusal, or null
   * when it has never named one. Never invented. */
  suggestedYear: number | null;
}) {
  const [value, setValue] = useState(String(currentSeasonYear));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = (year: number, why: string) => {
    if (pending) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await setTargetSeason(year, why);
      setError(result.error);
      setSaved(result.error === null);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
          Season starting year
          <input
            type="number"
            inputMode="numeric"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setSaved(false);
            }}
            className="h-11 w-32 rounded-lg border border-hairline bg-surface-1 px-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            aria-label="Season starting year"
          />
        </label>
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
          Why (optional)
          <input
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. free plan only covers 2022-2024"
            className="h-11 w-full rounded-lg border border-hairline bg-surface-1 px-3 text-sm text-foreground placeholder:text-foreground-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          />
        </label>
        <button
          type="button"
          disabled={pending}
          aria-busy={pending}
          onClick={() => {
            const parsed = Number(value.trim());
            if (!Number.isInteger(parsed)) {
              setError(`"${value}" is not a year. Enter the season's starting year — 2024 means the 2024/25 season.`);
              return;
            }
            submit(parsed, reason);
          }}
          className="flex min-h-11 items-center gap-1.5 rounded-lg bg-accent/15 px-3 text-xs font-semibold text-accent transition hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
        >
          {pending ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <Check className="h-3.5 w-3.5" strokeWidth={2} />
          )}
          Set target season
        </button>
        {isOverride && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (pending) return;
              setError(null);
              setSaved(false);
              startTransition(async () => {
                const result = await clearTargetSeason();
                setError(result.error);
                if (result.error === null) {
                  setValue(String(result.seasonYear ?? calendarSeasonYear));
                  setSaved(true);
                }
              });
            }}
            className="flex min-h-11 items-center gap-1.5 rounded-lg bg-surface-1 px-3 text-xs font-semibold text-foreground-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
            Back to {calendarSeasonYear} (the calendar season)
          </button>
        )}
      </div>

      {suggestedYear !== null && suggestedYear !== currentSeasonYear && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setValue(String(suggestedYear));
            submit(suggestedYear, reason.trim().length > 0 ? reason : `Plan does not cover ${calendarSeasonYear}`);
          }}
          className="inline-flex min-h-11 items-center self-start rounded-lg border border-accent/30 bg-accent/10 px-3 text-left text-xs font-medium text-accent transition hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
        >
          Use {suggestedYear} — a season the provider itself said this plan can serve
        </button>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-critical" role="status">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="text-xs text-live" role="status">
          Saved. The next sync of any season-scoped endpoint will ask for this year — nothing already in the database
          moved.
        </p>
      )}
    </div>
  );
}
