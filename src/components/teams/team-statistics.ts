/**
 * Season averages for one club, computed from the per-match rows KIVO really
 * holds in `fixture_statistics`.
 *
 * ## The rule this module exists to enforce
 *
 * Every column in `fixture_statistics` is nullable, and they are null
 * independently of each other — a provider that reports possession for a match
 * may report no expected-goals figure for the same match. So each average
 * carries its OWN sample size, counted from the matches that actually reported
 * that metric, and a metric with no reporting matches is absent rather than
 * zero. Averaging "possession over 12 matches" and "xG over 3" into one row of
 * numbers labelled "this season" would be two true figures forming one false
 * statement.
 *
 * Percentage-style metrics (shot accuracy, pass accuracy) are computed as a
 * ratio of the two summed counts, not as a mean of the per-match percentages —
 * a 1-shot match and a 30-shot match do not deserve equal weight in "how
 * accurate is this team's shooting", and the mean-of-percentages answer is
 * simply a different (and wrong) question.
 */

export type TeamMatchStatisticsRow = {
  possession_pct: number | null;
  shots_total: number | null;
  shots_on_target: number | null;
  passes_total: number | null;
  passes_accurate: number | null;
  corners: number | null;
  fouls: number | null;
  expected_goals: number | null;
};

export type AveragedMetric = {
  /** The average itself, already rounded for display. */
  value: number;
  /** How many matches genuinely reported this metric. Never inferred. */
  sample: number;
};

export type RatioMetric = {
  made: number;
  attempted: number;
  /** Whole-number percentage, rounded. */
  pct: number;
  sample: number;
};

export type TeamStatisticsSummary = {
  /** Matches with at least one reported statistic of any kind. */
  matchesWithStatistics: number;
  possession: AveragedMetric | null;
  shotsPerMatch: AveragedMetric | null;
  shotsOnTargetPerMatch: AveragedMetric | null;
  cornersPerMatch: AveragedMetric | null;
  foulsPerMatch: AveragedMetric | null;
  expectedGoalsPerMatch: AveragedMetric | null;
  shotAccuracy: RatioMetric | null;
  passAccuracy: RatioMetric | null;
};

function average(rows: TeamMatchStatisticsRow[], pick: (row: TeamMatchStatisticsRow) => number | null, decimals: number): AveragedMetric | null {
  const values = rows.map(pick).filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const factor = 10 ** decimals;
  return { value: Math.round(mean * factor) / factor, sample: values.length };
}

function ratio(
  rows: TeamMatchStatisticsRow[],
  pickMade: (row: TeamMatchStatisticsRow) => number | null,
  pickAttempted: (row: TeamMatchStatisticsRow) => number | null,
): RatioMetric | null {
  // Both halves must be present in the SAME match, or the ratio spans two
  // different sets of matches and means nothing.
  const usable = rows.filter((row) => pickMade(row) !== null && pickAttempted(row) !== null);
  if (usable.length === 0) return null;
  const made = usable.reduce((sum, row) => sum + pickMade(row)!, 0);
  const attempted = usable.reduce((sum, row) => sum + pickAttempted(row)!, 0);
  if (attempted <= 0) return null;
  return { made, attempted, pct: Math.round((made / attempted) * 100), sample: usable.length };
}

export function summarizeTeamStatistics(rows: TeamMatchStatisticsRow[]): TeamStatisticsSummary {
  const withAnything = rows.filter((row) =>
    Object.values(row).some((value) => value !== null),
  );

  return {
    matchesWithStatistics: withAnything.length,
    possession: average(rows, (row) => row.possession_pct, 1),
    shotsPerMatch: average(rows, (row) => row.shots_total, 1),
    shotsOnTargetPerMatch: average(rows, (row) => row.shots_on_target, 1),
    cornersPerMatch: average(rows, (row) => row.corners, 1),
    foulsPerMatch: average(rows, (row) => row.fouls, 1),
    expectedGoalsPerMatch: average(rows, (row) => row.expected_goals, 2),
    shotAccuracy: ratio(rows, (row) => row.shots_on_target, (row) => row.shots_total),
    passAccuracy: ratio(rows, (row) => row.passes_accurate, (row) => row.passes_total),
  };
}

/** True when there is at least one real figure to render. A club with rows in
 * the table but every column null has statistics in the same sense an empty
 * page has words. */
export function hasTeamStatistics(summary: TeamStatisticsSummary): boolean {
  return (
    summary.possession !== null ||
    summary.shotsPerMatch !== null ||
    summary.shotsOnTargetPerMatch !== null ||
    summary.cornersPerMatch !== null ||
    summary.foulsPerMatch !== null ||
    summary.expectedGoalsPerMatch !== null ||
    summary.shotAccuracy !== null ||
    summary.passAccuracy !== null
  );
}
