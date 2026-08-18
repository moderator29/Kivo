import { cn } from "@/lib/utils";

export type SeriesPoint = {
  /** Milliseconds since epoch. Only used for ordering and axis labels — the
   * chart's x-axis is the *sequence* of observations, evenly spaced, because
   * KIVO's snapshots are irregular by design (`record_standings_snapshot`
   * writes only when something changed) and spacing them by real elapsed time
   * would compress a whole season into the right-hand quarter of the box. */
  t: number;
  value: number;
  /** The x-axis label for this observation, already formatted. */
  label: string;
};

/**
 * KIVO's line chart.
 *
 * The one interaction idea worth taking wholesale from the references the
 * founder sent: a value pinned to the current point at the right edge, so the
 * number you came for is legible without reading the axis, and the line is
 * context rather than the subject.
 *
 * Two deliberate departures from the reference, both about honesty:
 *
 * - **The line is stepped, not smoothed.** A snapshot is an observation of a
 *   value that then *held* until the next observation. A smooth curve between
 *   two snapshots claims KIVO knows a value in between, and it does not. A
 *   step says "this was true until it wasn't", which is exactly what the row
 *   in `standings_snapshots` records.
 * - **No axis is invented.** The y-domain is the real minimum and maximum of
 *   the data given, padded, and never anchored at a zero the series does not
 *   contain.
 *
 * Structurally an SVG for the line and area (non-uniformly scaled, with
 * `vector-effect` keeping the stroke at a true 2px) plus absolutely-positioned
 * HTML for every dot and label. That split is what keeps the dots circular and
 * the type crisp at any container width, which a single stretched SVG cannot
 * do.
 */
export function SeriesChart({
  points,
  formatValue,
  /** True when a *lower* value is better and belongs at the top of the box —
   * a league position. False for anything that grows upward, like points. */
  lowerIsBetter = false,
  height = 148,
  ariaLabel,
  className,
}: {
  points: SeriesPoint[];
  formatValue: (value: number) => string;
  lowerIsBetter?: boolean;
  height?: number;
  ariaLabel: string;
  className?: string;
}) {
  // A single observation is not a series. The caller is expected to check
  // this too — this is the guard that keeps a bad call from drawing a line
  // between a point and nothing.
  if (points.length < 2) return null;

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  /** 0 = top of the plot, 100 = bottom. 10% padding top and bottom so the
   * extremes are not drawn on the frame itself; a flat series sits centred
   * rather than collapsing onto an edge. */
  function y(value: number): number {
    if (span === 0) return 50;
    const ratio = lowerIsBetter ? (value - min) / span : (max - value) / span;
    return 10 + ratio * 80;
  }

  function x(index: number): number {
    return (index / (points.length - 1)) * 100;
  }

  // "Held until the next observation": horizontal to the next x at the old
  // value, then vertical to the new one.
  const linePath = points
    .map((point, index) =>
      index === 0
        ? `M ${x(0)} ${y(point.value)}`
        : `H ${x(index)} V ${y(point.value)}`,
    )
    .join(" ");
  const areaPath = `${linePath} V 100 H 0 Z`;

  const last = points[points.length - 1];
  const gradientId = `series-fill-${points.length}-${Math.round(last.value * 100)}`;

  return (
    <figure className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-stretch gap-1">
        <div className="relative min-w-0 flex-1" style={{ height }}>
          {/* Three hairlines, not a full grid. Enough to read a slope against;
              not so much that the chrome competes with the data. */}
          {[0, 50, 100].map((position) => (
            <span
              key={position}
              aria-hidden="true"
              className="absolute inset-x-0 h-px bg-hairline-soft"
              style={{ top: `${position}%` }}
            />
          ))}

          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            role="img"
            aria-label={ariaLabel}
            className="absolute inset-0 h-full w-full overflow-visible"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={areaPath} fill={`url(#${gradientId})`} />
            <path
              d={linePath}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* The leader from the current point out to the pill. Without it the
              pill reads as a separate badge that happens to sit nearby; with
              it, it reads as a label on the line's end, which is the whole
              idea being borrowed. */}
          <span
            aria-hidden="true"
            className="absolute right-0 h-px translate-x-full border-t border-dashed border-accent/40"
            style={{ top: `${y(last.value)}%`, width: "0.5rem" }}
          />

          {points.map((point, index) => {
            const isLast = index === points.length - 1;
            return (
              <span
                key={`${point.t}-${index}`}
                aria-hidden="true"
                className={cn(
                  "absolute -translate-x-1/2 -translate-y-1/2 rounded-full",
                  isLast
                    ? "h-2.5 w-2.5 bg-accent ring-4 ring-accent/20"
                    : "h-1.5 w-1.5 bg-accent/70",
                )}
                style={{ left: `${x(index)}%`, top: `${y(point.value)}%` }}
              />
            );
          })}
        </div>

        {/* The value pill, pinned to the current point's height. Its own
            column rather than an overlay, so it can never sit on top of the
            line it is labelling on a narrow screen. */}
        <div className="relative w-12 shrink-0" style={{ height }}>
          <span
            className="absolute right-0 -translate-y-1/2 rounded-lg bg-accent-strong px-2 py-1 text-[11px] font-semibold tabular-nums text-on-accent shadow-soft"
            style={{ top: `${y(last.value)}%` }}
          >
            {formatValue(last.value)}
          </span>
        </div>
      </div>

      <figcaption className="flex items-center justify-between gap-2 pr-13 text-[11px] text-foreground-subtle">
        <span className="truncate">{points[0].label}</span>
        {points.length > 2 && (
          <span className="hidden truncate sm:inline">{points[Math.floor((points.length - 1) / 2)].label}</span>
        )}
        <span className="truncate">{last.label}</span>
      </figcaption>
    </figure>
  );
}
