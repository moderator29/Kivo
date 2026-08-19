import { CalendarClock } from "lucide-react";
import { formatDate, formatDurationUntil } from "@/lib/format";
import type { RecordedTransferActivity, TransferWindow } from "@/lib/football/transfer-window";

/**
 * The Transfer Centre's window panel.
 *
 * The directive asks for a window countdown. When a verified window is
 * configured in `TRANSFER_WINDOWS` this renders exactly that — a real
 * countdown to a real close, with the source it came from. When none is (the
 * state today), it says why in one sentence and shows the thing KIVO can
 * actually stand behind instead: how many moves it has genuinely recorded
 * lately.
 *
 * The alternative — inventing plausible window dates so the countdown always
 * has something to count to — would be a fabricated deadline on a page whose
 * whole premise is that its numbers are real, and it would be invisible
 * fabrication, because a wrong window date looks exactly like a right one.
 */
export function TransferWindowPanel({
  window,
  activity,
  now,
}: {
  window: TransferWindow | null;
  activity: RecordedTransferActivity;
  /** The clock the page rendered against, passed in rather than read here so
   * the countdown, the activity counts and the window selection all agree on
   * what "now" was — and so a server render stays reproducible. */
  now: Date;
}) {
  const countdown = window ? formatDurationUntil(window.closesAt, now) : null;

  return (
    <div className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <CalendarClock className="h-4 w-4 text-accent" strokeWidth={1.75} />
        {window ? "Window closes in" : "Recorded activity"}
      </h2>

      {window && countdown ? (
        <div className="flex flex-col gap-1">
          <span className="text-2xl font-semibold tabular-nums text-foreground">{countdown}</span>
          <span className="text-xs text-foreground-muted">
            {window.scope} · closes {formatDate(window.closesAt, { month: "short" })}
          </span>
          <a
            href={window.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="kivo-focus w-fit text-[11px] text-accent underline decoration-hairline-strong underline-offset-4 hover:text-accent-strong"
          >
            Source
          </a>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            <Cell label="Last 7 days" value={activity.last7Days} />
            <Cell label="Last 30 days" value={activity.last30Days} />
            <Cell label="Clubs involved" value={activity.clubsInvolvedLast30Days} />
          </div>
          {activity.mostRecentDate && (
            <span className="text-xs text-foreground-muted">
              Most recent recorded move: {formatDate(activity.mostRecentDate, { month: "short" })}.
            </span>
          )}
          <p className="text-[11px] leading-relaxed text-foreground-subtle">
            No countdown yet: registration windows are set per national association, change every year, and are not in
            the data KIVO syncs. Rather than type in dates it cannot cite, KIVO shows what it has actually recorded.
            The countdown turns on the moment a verified window is configured.
          </p>
        </div>
      )}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-hairline bg-surface-1 p-3">
      <span className="text-lg font-semibold tabular-nums text-foreground">{value}</span>
      <span className="text-center text-[10px] uppercase tracking-wide text-foreground-subtle">{label}</span>
    </div>
  );
}
