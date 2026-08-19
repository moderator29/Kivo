/**
 * One player's own numbers for one match, and how two of them are compared.
 *
 * ## Where this comes from
 *
 * `fixture_player_statistics` (migration 0081) — a table KIVO has been filling
 * and paying for and never once put on screen. It is counts only: what a
 * player did, never where. There are no coordinates in it on any tier, which
 * is why this file draws comparisons and lists and nothing shaped like a pitch
 * map.
 *
 * ## The rule every metric obeys
 *
 * Null means "not reported" and is never rendered or computed as zero. A
 * midfielder with `tackles_total` null is one nobody counted; one with 0 made
 * none, and those are different sentences about a footballer. So a metric row
 * appears only when at least one of the two players has a real value for it,
 * the other side reads as absent rather than as nought, and nothing is
 * compared across a value that was never reported.
 *
 * ## What is deliberately not here
 *
 * The data source ships its own per-player rating. KIVO has its own rating
 * engine (`rating-engine.ts`) with its method published, and putting a second,
 * differently-derived number beside it under the same word would leave a fan
 * with two ratings and no way to tell whose opinion either was. One rating,
 * KIVO's, stated as KIVO's.
 */

export type PlayerMatchLine = {
  playerId: string;
  playerName: string;
  teamId: string;
  /** The data source's coarse deployment letter for this match (G/D/M/F), or
   * null. Bucketed, never a taxonomy — rendered as-is or not at all. */
  position: string | null;
  isSubstitute: boolean | null;
  minutesPlayed: number | null;
  goals: number | null;
  assists: number | null;
  shotsTotal: number | null;
  shotsOnTarget: number | null;
  passesTotal: number | null;
  passesKey: number | null;
  passAccuracy: number | null;
  tacklesTotal: number | null;
  interceptions: number | null;
  blocks: number | null;
  duelsTotal: number | null;
  duelsWon: number | null;
  dribblesAttempted: number | null;
  dribblesSucceeded: number | null;
  foulsDrawn: number | null;
  foulsCommitted: number | null;
  saves: number | null;
  goalsConceded: number | null;
  offsides: number | null;
};

type CountMetric = {
  kind: "count";
  key: keyof PlayerMatchLine;
  label: string;
  suffix?: string;
};

type RatioMetric = {
  kind: "ratio";
  key: keyof PlayerMatchLine;
  ofKey: keyof PlayerMatchLine;
  label: string;
};

export type PlayerMetric = CountMetric | RatioMetric;

/**
 * Ordered the way a fan reads a player's match: how long they were on, what
 * they produced, what they attempted, what they won back, what it cost.
 * Goalkeeping sits at the end because it is empty for almost everyone and a
 * blank "Saves" row above "Goals" would misfile every outfield player.
 */
export const PLAYER_METRICS: PlayerMetric[] = [
  { kind: "count", key: "minutesPlayed", label: "Minutes", suffix: "'" },
  { kind: "count", key: "goals", label: "Goals" },
  { kind: "count", key: "assists", label: "Assists" },
  { kind: "count", key: "shotsTotal", label: "Shots" },
  { kind: "count", key: "shotsOnTarget", label: "On target" },
  { kind: "count", key: "passesKey", label: "Key passes" },
  { kind: "count", key: "passesTotal", label: "Passes" },
  { kind: "count", key: "passAccuracy", label: "Pass accuracy", suffix: "%" },
  { kind: "ratio", key: "dribblesSucceeded", ofKey: "dribblesAttempted", label: "Dribbles" },
  { kind: "ratio", key: "duelsWon", ofKey: "duelsTotal", label: "Duels won" },
  { kind: "count", key: "tacklesTotal", label: "Tackles" },
  { kind: "count", key: "interceptions", label: "Interceptions" },
  { kind: "count", key: "blocks", label: "Blocks" },
  { kind: "count", key: "foulsDrawn", label: "Fouls won" },
  { kind: "count", key: "foulsCommitted", label: "Fouls conceded" },
  { kind: "count", key: "offsides", label: "Offsides" },
  { kind: "count", key: "saves", label: "Saves" },
  { kind: "count", key: "goalsConceded", label: "Goals conceded" },
];

export type MetricCell =
  /** A real reported number, and the value the comparison bar divides by. */
  | { reported: true; text: string; weight: number }
  /** Nothing was reported. There is no number and nothing to weigh. */
  | { reported: false };

export type ComparedMetric = {
  label: string;
  left: MetricCell;
  right: MetricCell;
  /** Only ever true when BOTH sides reported, which is the only case where a
   * split bar is a fact rather than a drawing. */
  comparable: boolean;
};

function numberAt(line: PlayerMatchLine, key: keyof PlayerMatchLine): number | null {
  const value = line[key];
  return typeof value === "number" ? value : null;
}

function cellFor(line: PlayerMatchLine | null, metric: PlayerMetric): MetricCell {
  if (!line) return { reported: false };
  const value = numberAt(line, metric.key);
  if (value === null) return { reported: false };

  if (metric.kind === "ratio") {
    const of = numberAt(line, metric.ofKey);
    // A "7 of" with no denominator is not a ratio. Fall back to the bare
    // count rather than printing a fraction with a hole in it.
    if (of === null) return { reported: true, text: String(value), weight: value };
    return { reported: true, text: `${value}/${of}`, weight: value };
  }

  return { reported: true, text: `${value}${metric.suffix ?? ""}`, weight: value };
}

/**
 * The rows two player lines can honestly be shown side by side on. A metric
 * neither of them reported is not a row — an all-dashes line teaches a reader
 * nothing except that the screen has gaps in it.
 */
export function comparePlayerLines(left: PlayerMatchLine | null, right: PlayerMatchLine | null): ComparedMetric[] {
  return PLAYER_METRICS.map((metric) => {
    const leftCell = cellFor(left, metric);
    const rightCell = cellFor(right, metric);
    return {
      label: metric.label,
      left: leftCell,
      right: rightCell,
      comparable: leftCell.reported && rightCell.reported,
    };
  }).filter((row) => row.left.reported || row.right.reported);
}

/**
 * Who a club's list leads with: most minutes first, and a player nobody
 * clocked sits below everyone who was. Ties fall back to the name so the order
 * is stable between renders rather than however the rows arrived.
 */
export function orderPlayerLines(lines: PlayerMatchLine[]): PlayerMatchLine[] {
  return [...lines].sort((a, b) => {
    const aMinutes = a.minutesPlayed ?? -1;
    const bMinutes = b.minutesPlayed ?? -1;
    if (aMinutes !== bMinutes) return bMinutes - aMinutes;
    return a.playerName.localeCompare(b.playerName);
  });
}

/** "1 goal", not "1 goals". Only the labels that can honestly be one of
 * something; a percentage or a ratio never reads as a count. */
const SINGULAR_LABEL: Record<string, string> = {
  Goals: "goal",
  Assists: "assist",
  Shots: "shot",
  "On target": "on target",
  "Key passes": "key pass",
  Passes: "pass",
  Tackles: "tackle",
  Interceptions: "interception",
  Blocks: "block",
  Saves: "save",
  "Goals conceded": "goal conceded",
  Offsides: "offside",
};

/** The two numbers a list row leads with, chosen from what this player
 * actually has rather than from a fixed pair that would be blank for most of
 * a team sheet. Empty when the line reports nothing countable at all. */
export function headlinePlayerMetrics(line: PlayerMatchLine): { label: string; text: string }[] {
  const preferred: PlayerMetric[] = PLAYER_METRICS.filter((metric) => metric.key !== "minutesPlayed");
  const cells: { label: string; text: string }[] = [];
  for (const metric of preferred) {
    const cell = cellFor(line, metric);
    // A row that leads with "Goals 0" says nothing; the interesting headline
    // is something that happened. Zeroes stay in the full comparison, where
    // "none" is a real answer to a question the reader asked.
    if (cell.reported && cell.weight > 0) {
      const singular = metric.kind === "count" && cell.weight === 1 ? SINGULAR_LABEL[metric.label] : undefined;
      cells.push({ label: singular ?? metric.label.toLowerCase(), text: cell.text });
    }
    if (cells.length === 2) break;
  }
  return cells;
}
