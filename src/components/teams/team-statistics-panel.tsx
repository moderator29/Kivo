import { StatBlock, StatGrid } from "@/components/ui/stat-block";
import type { TeamStatisticsSummary } from "@/components/teams/team-statistics";

/**
 * How a club plays, in the numbers KIVO actually holds per match.
 *
 * Bars for the three metrics that are genuinely proportions — possession, shot
 * accuracy, pass accuracy — because a proportion is the one thing a bar can
 * draw without inventing a scale. Everything else is a per-match average and is
 * printed as a number, not as a bar of unstated maximum: "13.5 shots" against a
 * bar whose full width means nothing in particular is decoration pretending to
 * be a chart.
 *
 * Each figure renders only if it has a real sample, and the footnote says how
 * many matches the figures came from — which is the difference between a
 * season average and a single match dressed as one.
 */

/**
 * A labelled proportion. Local to this file on purpose: it is the only bar in
 * the product, `docs/UI_PRIMITIVES.md` sanctions no shared one, and a
 * one-caller "primitive" in a shared folder is how a component library starts
 * accumulating things nobody uses.
 *
 * It takes `value` and `max` rather than a percentage so it cannot be handed a
 * figure whose denominator has been lost — a caller with no real denominator
 * has no bar to draw.
 */
function MetricBar({
  label,
  value,
  max,
  display,
}: {
  label: string;
  value: number;
  max: number;
  display: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm text-foreground-muted">{label}</span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{display}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-track">
        <div className="kivo-gradient-prime h-full rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function TeamStatisticsPanel({ summary }: { summary: TeamStatisticsSummary }) {
  const tiles = [
    summary.shotsPerMatch && { label: "Shots", value: summary.shotsPerMatch.value.toFixed(1) },
    summary.shotsOnTargetPerMatch && { label: "On target", value: summary.shotsOnTargetPerMatch.value.toFixed(1) },
    summary.cornersPerMatch && { label: "Corners", value: summary.cornersPerMatch.value.toFixed(1) },
    summary.foulsPerMatch && { label: "Fouls", value: summary.foulsPerMatch.value.toFixed(1) },
    summary.expectedGoalsPerMatch && { label: "xG", value: summary.expectedGoalsPerMatch.value.toFixed(2) },
  ].filter((tile): tile is { label: string; value: string } => Boolean(tile));

  const bars = [
    summary.possession && {
      key: "possession",
      label: "Average possession",
      value: summary.possession.value,
      max: 100,
      display: `${summary.possession.value.toFixed(1)}%`,
    },
    summary.shotAccuracy && {
      key: "shot-accuracy",
      label: "Shots on target",
      value: summary.shotAccuracy.made,
      max: summary.shotAccuracy.attempted,
      display: `${summary.shotAccuracy.pct}%`,
    },
    summary.passAccuracy && {
      key: "pass-accuracy",
      label: "Pass accuracy",
      value: summary.passAccuracy.made,
      max: summary.passAccuracy.attempted,
      display: `${summary.passAccuracy.pct}%`,
    },
  ].filter((bar): bar is { key: string; label: string; value: number; max: number; display: string } => Boolean(bar));

  return (
    <div className="kivo-glass flex flex-col gap-5 rounded-2xl p-5">
      {bars.length > 0 && (
        <div className="flex flex-col gap-3">
          {bars.map((bar) => (
            <MetricBar key={bar.key} label={bar.label} value={bar.value} max={bar.max} display={bar.display} />
          ))}
        </div>
      )}

      {tiles.length > 0 && (
        // `inset`: this card is already the surface, and a StatGrid with its
        // own would be the card-inside-a-card DENSITY_RULES forbids.
        <StatGrid inset columns={3} className={bars.length > 0 ? "border-t border-hairline-soft pt-5" : undefined}>
          {tiles.map((tile) => (
            <StatBlock key={tile.label} label={tile.label} value={tile.value} />
          ))}
        </StatGrid>
      )}

      <p className="text-xs leading-relaxed text-foreground-subtle">
        Per match, from the {summary.matchesWithStatistics}{" "}
        {summary.matchesWithStatistics === 1 ? "match" : "matches"} with statistics on record. A metric only appears
        once at least one match has reported it.
      </p>
    </div>
  );
}
