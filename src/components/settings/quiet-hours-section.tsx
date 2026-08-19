"use client";

import { useState, useTransition } from "react";
import { Info, Loader2, MoonStar } from "lucide-react";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { updateQuietHours } from "@/app/(app)/settings/actions";
import type { QuietHoursSettings } from "@/app/(app)/settings/actions";
import { RetryableError } from "@/components/ui/retryable-error";

/**
 * Quiet hours (migration 0088), and the one screen where KIVO has to be
 * straight about what they currently do.
 *
 * Every notification KIVO sends is in-app — there is no push and no email — so
 * quiet hours cannot stop anything arriving on a phone, because nothing
 * arrives on a phone. What they can do is stop the unread badge, which is the
 * only thing in the product that currently interrupts anyone. The copy says
 * exactly that instead of implying a Do Not Disturb this product does not yet
 * have.
 *
 * The window is saved as one unit. A start with no end is not a half-saved
 * preference, it is an incoherent one, so the Save button commits all three
 * fields together and the toggle is part of the same write.
 */
export function QuietHoursSection({
  initial,
  timeZone,
}: {
  initial: QuietHoursSettings;
  /** The user's stated `profiles.timezone`, or null when they have never told
   * KIVO — in which case quiet hours cannot be evaluated at all, and this says
   * so rather than silently applying UTC. */
  timeZone: string | null;
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const dirty = enabled !== initial.enabled || start !== initial.start || end !== initial.end;

  function save(next: { enabled: boolean; start: string; end: string }) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateQuietHours(next);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSaved(true);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
            <MoonStar className="h-4 w-4 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
            Quiet hours
          </span>
          <span className="text-xs leading-relaxed text-foreground-muted">
            Hold the unread badge back overnight. Nothing is deleted — everything that happens is still in your
            notifications, it just waits until the window ends before asking for your attention.
          </span>
        </div>
        <ToggleSwitch
          checked={enabled}
          onChange={() => {
            const next = !enabled;
            setEnabled(next);
            save({ enabled: next, start, end });
          }}
          label="Quiet hours"
          disabled={pending}
        />
      </div>

      {enabled && (
        <div className="flex flex-col gap-3 border-t border-hairline-soft pt-3">
          {/* Two inputs on one row and Save on the next. A 12-hour locale
              renders `<input type="time">` as "10:00 PM" plus a picker glyph,
              which does not fit three controls across 390px — squeezing them
              onto one row clipped the time itself, which is the one thing the
              control exists to show. */}
          <div className="flex items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[11px] font-medium text-foreground-subtle">From</span>
              <input
                type="time"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                className="kivo-focus w-full rounded-xl border border-hairline bg-surface-inset px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[11px] font-medium text-foreground-subtle">To</span>
              <input
                type="time"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                className="kivo-focus w-full rounded-xl border border-hairline bg-surface-inset px-3 py-2 text-sm text-foreground"
              />
            </label>
          </div>
          <button
            type="button"
            disabled={pending || !dirty}
            onClick={() => save({ enabled, start, end })}
            className="kivo-gradient-prime kivo-focus flex w-fit items-center gap-1.5 rounded-xl px-5 py-2 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
            {dirty ? "Save" : "Saved"}
          </button>

          {/* The window crossing midnight is the normal case, not an edge one,
              so it is described rather than warned about. */}
          {start > end && (
            <p className="text-[11px] text-foreground-subtle">This window runs overnight, from {start} to {end} the next day.</p>
          )}

          {timeZone ? (
            <p className="text-[11px] text-foreground-subtle">Times are in your timezone, {timeZone}.</p>
          ) : (
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-warning">
              <Info className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2} />
              KIVO doesn&apos;t know your timezone yet, so quiet hours can&apos;t be applied. Set it in Settings →
              Privacy and this starts working — KIVO never guesses a timezone from your connection.
            </p>
          )}

          <p className="text-[11px] leading-relaxed text-foreground-subtle">
            Fantasy deadlines and anything about your account still come through — those are the only two things
            you lose by hearing about them in the morning.
          </p>
        </div>
      )}

      {error && <RetryableError size="xs" message={error} retrying={pending} onRetry={() => save({ enabled, start, end })} />}
      {saved && !error && (
        <p className="text-xs text-live" role="status" aria-live="polite">
          Saved
        </p>
      )}
    </div>
  );
}
