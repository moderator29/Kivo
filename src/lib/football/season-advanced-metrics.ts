import type { Database } from "@/lib/supabase/types";

/**
 * The rest of a synced season row, grouped for reading.
 *
 * `player_season_statistics` stores twenty-eight stat-bearing columns per
 * player, per competition, per season. The by-competition table on the player
 * page renders four of them — appearances, minutes, goals, assists — which is
 * the right headline and the wrong total. Everything the provider actually
 * reported for a shot, a pass, a duel, a tackle, a card and a save was already
 * in the database, already refreshed on every sync, and read by nothing.
 *
 * This is the display side of that gap. It costs no provider quota and adds no
 * new data: it is the same rows, shown.
 *
 * ## Three rules, and they are the whole file
 *
 * **1. Null is not zero.** A dash means the provider did not report it. A zero
 * means it happened zero times. `buildAdvancedMetricGroups` drops a metric
 * entirely rather than emitting a zero for an absent one, so a group that
 * renders at all is a group with something real in it.
 *
 * **2. Never pair two numbers whose scopes differ.** A ratio needs both halves
 * from the same row or it is not a ratio. "12 of 20 dribbles" with a missing
 * denominator is not "12 dribbles" — it is a fraction with an invented bottom.
 * When only one half is reported, the surviving half is emitted under its own
 * precise label ("Dribbles completed"), never as a ratio.
 *
 * **3. Never sum across competitions.** Nothing here aggregates. Every value
 * emitted belongs to exactly one competition row, and the caller renders it
 * under that competition's own name. The headline table above it shows a total
 * only where the provider covered every competition; this panel shows no
 * totals at all, because a "shots" total spanning a different set of
 * competitions from a "tackles" total is two true numbers forming one false
 * pair — the failure this codebase is most prone to, because both halves are
 * real and nothing about the row looks wrong.
 */

export type SeasonStatisticsRow = Pick<
  Database["public"]["Tables"]["player_season_statistics"]["Row"],
  | "lineups"
  | "position"
  | "provider_rating"
  | "shots_total"
  | "shots_on_target"
  | "penalties_scored"
  | "penalties_missed"
  | "passes_total"
  | "passes_key"
  | "pass_accuracy"
  | "dribbles_attempted"
  | "dribbles_succeeded"
  | "duels_total"
  | "duels_won"
  | "tackles_total"
  | "interceptions"
  | "blocks"
  | "fouls_committed"
  | "fouls_drawn"
  | "yellow_cards"
  | "red_cards"
  | "saves"
  | "goals_conceded"
>;

export type AdvancedMetric = { label: string; value: string };
export type AdvancedMetricGroup = { title: string; metrics: AdvancedMetric[] };

const NUMBER_FORMAT = new Intl.NumberFormat("en-GB");

/** A metric exists only if its value does. Returns null for an unreported
 * one so the caller can drop it rather than print a dash nobody asked for. */
function metric(label: string, value: number | null, format?: (value: number) => string): AdvancedMetric | null {
  if (value === null) return null;
  return { label, value: format ? format(value) : NUMBER_FORMAT.format(value) };
}

/**
 * A completed-of-attempted pair, but only when the provider reported both.
 *
 * With one half missing this deliberately degrades to the half that exists,
 * under a label that describes exactly that half. The alternative — showing
 * "12" where "12 of 20" belongs, or "12 of 0" — reads as a complete ratio and
 * is not one.
 *
 * All three labels are given explicitly rather than derived from each other.
 * The first version of this built the denominator-only label by stripping a
 * trailing word off the numerator's, which rendered a season where the
 * provider gave shot volume but no accuracy as "Shots on target attempted: 9"
 * — a real number under a label describing something else. A label is part of
 * the claim, so it gets written, not computed.
 */
type RatioLabels = {
  /** Both halves reported: "34 of 71". */
  pair: string;
  /** Numerator only. */
  completed: string;
  /** Denominator only. */
  attempted: string;
};

function ratio(labels: RatioLabels, completed: number | null, attempted: number | null): AdvancedMetric | null {
  if (completed !== null && attempted !== null) {
    return { label: labels.pair, value: `${NUMBER_FORMAT.format(completed)} of ${NUMBER_FORMAT.format(attempted)}` };
  }
  if (completed !== null) return { label: labels.completed, value: NUMBER_FORMAT.format(completed) };
  if (attempted !== null) return { label: labels.attempted, value: NUMBER_FORMAT.format(attempted) };
  return null;
}

function percent(value: number): string {
  // The provider reports accuracy as a whole-number percentage. Rendering the
  // unit matters: a bare "84" next to "84 passes" is a different claim.
  return `${NUMBER_FORMAT.format(value)}%`;
}

/** The provider's own rating, to the precision it publishes. Labelled as the
 * provider's everywhere it is rendered — KIVO's rating engine is a separate
 * thing and the two must never be read as one number. */
function rating(value: number): string {
  return value.toFixed(2);
}

/**
 * Every group with at least one reported metric in it, in reading order.
 * Groups with nothing reported are absent, not empty: an outfielder has no
 * goalkeeping section rather than a goalkeeping section full of dashes.
 */
export function buildAdvancedMetricGroups(row: SeasonStatisticsRow): AdvancedMetricGroup[] {
  const groups: { title: string; metrics: (AdvancedMetric | null)[] }[] = [
    {
      title: "Selection",
      metrics: [
        metric("Started", row.lineups),
        row.position ? { label: "Position", value: row.position } : null,
        metric("Provider rating", row.provider_rating, rating),
      ],
    },
    {
      title: "Attacking",
      metrics: [
        ratio({ pair: "Shots on target", completed: "Shots on target", attempted: "Shots" }, row.shots_on_target, row.shots_total),
        metric("Penalties scored", row.penalties_scored),
        metric("Penalties missed", row.penalties_missed),
      ],
    },
    {
      title: "Passing",
      metrics: [
        metric("Passes", row.passes_total),
        metric("Key passes", row.passes_key),
        metric("Pass accuracy", row.pass_accuracy, percent),
        ratio(
          { pair: "Dribbles completed", completed: "Dribbles completed", attempted: "Dribbles attempted" },
          row.dribbles_succeeded,
          row.dribbles_attempted,
        ),
      ],
    },
    {
      title: "Defending",
      metrics: [
        ratio({ pair: "Duels won", completed: "Duels won", attempted: "Duels contested" }, row.duels_won, row.duels_total),
        metric("Tackles", row.tackles_total),
        metric("Interceptions", row.interceptions),
        metric("Blocks", row.blocks),
      ],
    },
    {
      title: "Discipline",
      metrics: [
        metric("Fouls committed", row.fouls_committed),
        metric("Fouls won", row.fouls_drawn),
        metric("Yellow cards", row.yellow_cards),
        metric("Red cards", row.red_cards),
      ],
    },
    {
      title: "Goalkeeping",
      metrics: [metric("Saves", row.saves), metric("Goals conceded", row.goals_conceded)],
    },
  ];

  return groups
    .map((group) => ({
      title: group.title,
      metrics: group.metrics.filter((entry): entry is AdvancedMetric => entry !== null),
    }))
    .filter((group) => group.metrics.length > 0);
}

/** Whether a row has anything at all beyond the four headline columns. Used to
 * decide whether the disclosure is worth offering — an empty one that opens
 * onto nothing is worse than no disclosure. */
export function hasAdvancedMetrics(row: SeasonStatisticsRow): boolean {
  return buildAdvancedMetricGroups(row).length > 0;
}
