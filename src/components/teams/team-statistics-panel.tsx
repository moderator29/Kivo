import { MetricBar, StatTile } from "@/components/football/entity-shell";
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
    <div className="kivo-glass flex flex-col gap-4 rounded-2xl p-5">
      {bars.length > 0 && (
        <div className="flex flex-col gap-3">
          {bars.map((bar) => (
            <MetricBar key={bar.key} label={bar.label} value={bar.value} max={bar.max} display={bar.display} />
          ))}
        </div>
      )}

      {tiles.length > 0 && (
        <div className={`grid gap-2 ${bars.length > 0 ? "border-t border-hairline-soft pt-4" : ""} grid-cols-3 sm:grid-cols-5`}>
          {tiles.map((tile) => (
            <StatTile key={tile.label} label={tile.label} value={tile.value} />
          ))}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-foreground-subtle">
        Per match, from the {summary.matchesWithStatistics}{" "}
        {summary.matchesWithStatistics === 1 ? "match" : "matches"} with statistics on record. A metric only appears
        once at least one match has reported it.
      </p>
    </div>
  );
}
