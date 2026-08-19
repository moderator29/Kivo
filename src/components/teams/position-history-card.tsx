"use client";

import { useState } from "react";
import Link from "next/link";
import { BellRing, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { SeriesChart, type SeriesPoint } from "@/components/charts/series-chart";
import { DISPLAY_LOCALE } from "@/lib/format";
import { cn } from "@/lib/utils";

export type PositionSnapshot = {
  /** `standings_snapshots.captured_at`. */
  capturedAt: string;
  /** `standings_snapshots.position`. Null rows are dropped by the caller —
   * a snapshot with no position is a real row about points and goals, and it
   * is simply not a point on *this* chart. */
  position: number;
  points: number;
  played: number;
};

/** Ranges offered above the chart. Each one is only shown when the team
 * genuinely has two or more snapshots inside it — a pill that redraws an
 * empty box is not a control, it is a dead end. */
const RANGES = [
  { id: "30d", label: "30d", days: 30 },
  { id: "90d", label: "3m", days: 90 },
  { id: "all", label: "Season", days: null },
] as const;

type RangeId = (typeof RANGES)[number]["id"];

/**
 * A team's league position over the season, drawn from `standings_snapshots`.
 *
 * Migration `0072` made this possible and nothing had read it yet: the table
 * is an append-only record of what the table said, written only when something
 * actually changed, and `get_team_position_history` returns one team's rows.
 * That is a genuine time series about a real football thing, which is why it
 * is the one chart in this product — KIVO does not have a portfolio, a balance
 * or a market cap to draw, and would not draw one if it did.
 *
 * Everything a reader can read off this is a stored row:
 *
 * - the line is the recorded positions, stepped, because a position held until
 *   the next snapshot said otherwise;
 * - the pill is the latest recorded position;
 * - the movement badge is the difference between the first and last snapshot
 *   *in the selected range*, and it says "over 30 days" rather than implying a
 *   rate of change;
 * - "since KIVO started watching" is stated plainly when the range is longer
 *   than the history, because a chart starting mid-season otherwise looks like
 *   a team that started mid-season.
 */
export function PositionHistoryCard({
  snapshots,
  competitionLabel,
  teamName,
}: {
  /** Oldest first. */
  snapshots: PositionSnapshot[];
  /** e.g. "Premier League · 2025/26". */
  competitionLabel: string;
  teamName: string;
}) {
  // Pinned at mount rather than read on every render: switching range must
  // not also move the window's own boundary underneath the reader, and a
  // clock read during render is impure besides.
  const [now] = useState(() => Date.now());

  const inRange = (range: (typeof RANGES)[number]) =>
    range.days === null
      ? snapshots
      : snapshots.filter((snapshot) => now - Date.parse(snapshot.capturedAt) <= range.days * 86_400_000);

  const available = RANGES.filter((range) => inRange(range).length >= 2);
  const [rangeId, setRangeId] = useState<RangeId>(available[available.length - 1]?.id ?? "all");

  const activeRange = available.find((range) => range.id === rangeId) ?? available[available.length - 1];
  if (!activeRange) return null;

  const windowed = inRange(activeRange);
  if (windowed.length < 2) return null;

  const first = windowed[0];
  const last = windowed[windowed.length - 1];
  // Positive means the team climbed: position 6 -> 4 is +2 places.
  const movement = first.position - last.position;
  const coversWholeHistory = windowed.length === snapshots.length;

  const points: SeriesPoint[] = windowed.map((snapshot) => ({
    t: Date.parse(snapshot.capturedAt),
    value: snapshot.position,
    label: shortDate(snapshot.capturedAt),
  }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
            Position over time
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums leading-none text-foreground">#{last.position}</span>
            <MovementBadge movement={movement} rangeLabel={activeRange.label} />
          </div>
        </div>
        <Link
          href="/settings/notifications"
          className="kivo-glass-sharp kivo-focus flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-foreground-muted transition-colors hover:text-foreground"
        >
          <BellRing className="h-3.5 w-3.5" strokeWidth={2} />
          Alerts
        </Link>
      </div>

      <SeriesChart
        points={points}
        lowerIsBetter
        formatValue={(value) => `#${value}`}
        ariaLabel={`${teamName}'s league position in ${competitionLabel}, from #${first.position} on ${shortDate(
          first.capturedAt,
        )} to #${last.position} on ${shortDate(last.capturedAt)}`}
        labelColumnLabel="Date"
        valueColumnLabel="Position"
      />

      {available.length > 1 && (
        <div
          role="group"
          aria-label="Chart range"
          className="flex items-center gap-1 rounded-xl bg-surface-track p-1"
        >
          {available.map((range) => (
            <button
              key={range.id}
              type="button"
              onClick={() => setRangeId(range.id)}
              aria-pressed={range.id === activeRange.id}
              className={cn(
                "kivo-focus flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                range.id === activeRange.id
                  ? "bg-surface-raised text-foreground shadow-soft"
                  : "text-foreground-subtle hover:text-foreground",
              )}
            >
              {range.label}
            </button>
          ))}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-foreground-subtle">
        {windowed.length} recorded change{windowed.length === 1 ? "" : "s"} in {competitionLabel}
        {coversWholeHistory ? ", which is everything KIVO has recorded so far" : ""}. A position is plotted only when
        the table actually changed.
      </p>
    </div>
  );
}

/**
 * The reference's percentage-change badge, re-pointed at the only change KIVO
 * can honestly claim here: places gained or lost. Never a percentage — a
 * percentage of a league position is not a quantity, and inventing one to fill
 * the shape is exactly the trade this product does not make.
 */
function MovementBadge({ movement, rangeLabel }: { movement: number; rangeLabel: string }) {
  if (movement === 0) {
    return (
      <span className="flex items-center gap-1 rounded-full border border-hairline px-2 py-0.5 text-[11px] font-semibold text-foreground-subtle">
        <Minus className="h-3 w-3" strokeWidth={2} />
        Level over {rangeLabel}
      </span>
    );
  }
  const climbed = movement > 0;
  const Icon = climbed ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        climbed ? "border-live/30 bg-live/10 text-live" : "border-critical/30 bg-critical/10 text-critical",
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2} />
      {climbed ? "+" : "−"}
      {Math.abs(movement)} over {rangeLabel}
    </span>
  );
}

/** "14 Aug". Pinned to DISPLAY_LOCALE and UTC for the same reason every other
 * date in this app is: a bare toLocaleDateString in a Client Component is a
 * hydration mismatch waiting for a visitor in another locale. */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(DISPLAY_LOCALE, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
