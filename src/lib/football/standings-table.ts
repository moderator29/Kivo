import { resultFor, type FormResult } from "./results";
import { classifyStandingsZone, type StandingsZone } from "./standings-zones";

/**
 * Everything the league table needs derived, done once and in one place.
 *
 * The table itself (src/components/standings/standings-table.tsx) is pure
 * presentation: it receives finished rows and renders them. This module is
 * where the three derivations live, and each one is bounded by what KIVO can
 * actually show without asserting something it does not know.
 *
 *   1. **Goal difference.** Subtraction. The only reason it is here is so the
 *      table never has to do arithmetic while rendering.
 *   2. **Movement** — has this team climbed or fallen since it last played?
 *      Read off `standings_snapshots`, which is an append-only record of what
 *      the table said (migration 0072). Never guessed.
 *   3. **Groups.** A group-stage table is several small tables, not one long
 *      ladder, and rendering the Champions League group stage as a single
 *      32-row list is a straightforwardly wrong picture of the competition.
 *
 * Zone classification is `./standings-zones`, which is deliberately separate:
 * it is the piece with the strongest rule about what it may not do, and it is
 * worth reading on its own.
 */

/** One `standings` row as the competition page selects it. */
export type StandingsSourceRow = {
  teamId: string;
  /** Null when the join found no team — rendered as a blank row, never as a
   * club with an invented name. */
  team: { id: string; name: string; crestUrl: string | null } | null;
  position: number | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  /**
   * The competition's own sentence about this place — "Promotion - Champions
   * League (Group Stage)", "Relegation - Championship". Absent for most
   * competitions and every source that publishes none, in which case the row
   * carries no zone and the table draws no line.
   */
  zoneDescription?: string | null;
  /** "Group A", "Group B" … Absent for a straight league. */
  groupLabel?: string | null;
};

/** One `standings_snapshots` row, newest first as the query returns them. */
export type StandingsSnapshotRow = {
  teamId: string;
  position: number | null;
  played: number;
};

/** Which way a team has moved, or `null` when KIVO has no earlier table to
 * compare against — a distinct state from "hasn't moved", and drawn as
 * nothing rather than as a level dash. */
export type StandingsMovement = "up" | "down" | "level" | null;

export type StandingsTableRow = {
  teamId: string;
  team: StandingsSourceRow["team"];
  position: number | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  zone: StandingsZone | null;
  movement: StandingsMovement;
  /** Newest result first, matching `FormBadges` and the rest of the app.
   * Empty when this team has no finished fixtures KIVO holds. */
  form: FormResult[];
};

export type StandingsGroup = {
  /** Stable key for React. The label when there is one, else a constant. */
  key: string;
  /** The competition's own group name, or null for a straight league table —
   * in which case the table renders no group heading at all rather than one
   * reading "Group" or "Main". */
  label: string | null;
  rows: StandingsTableRow[];
};

/** Newest-first finished results for one team, as `computeStandingsForm`
 * wants them. Callers resolve fixtures with `resolveFixtureResult`. */
export type TeamFormInput = { ownScore: number; oppScore: number };

/**
 * The last `size` results for each team, newest first.
 *
 * Deliberately derived from KIVO's own finished fixtures rather than from any
 * form string a source might publish alongside the table: those strings carry
 * no stated orientation, and rendering "WWLDW" backwards turns a team on a
 * three-match winning run into one on a losing run while looking entirely
 * plausible. A form guide computed from fixtures whose kickoff times KIVO
 * holds cannot be reversed by accident.
 */
export function computeStandingsForm(
  resultsNewestFirst: TeamFormInput[],
  size = 5,
): FormResult[] {
  return resultsNewestFirst.slice(0, size).map((result) => resultFor(result.ownScore, result.oppScore));
}

/**
 * Movement since this team last played.
 *
 * The comparison point is the most recent snapshot taken when the team had
 * played FEWER matches than it has now — i.e. the table as it stood before
 * this team's latest result. That definition is what a fan means by "up two
 * places this week", and it is immune to the mid-week corrections and
 * re-captures that would make "the previous snapshot, whatever it was" report
 * movement nobody experienced.
 *
 * Null whenever the comparison cannot be made honestly: no earlier snapshot,
 * or either position missing.
 */
export function movementSinceLastPlayed(
  current: { position: number | null; played: number },
  snapshotsNewestFirst: StandingsSnapshotRow[],
): StandingsMovement {
  if (current.position === null) return null;
  const previous = snapshotsNewestFirst.find((snapshot) => snapshot.played < current.played);
  if (!previous || previous.position === null) return null;
  // A SMALLER position number is a better place, so a drop in the number is a
  // climb up the table. Worth stating: this is the one comparison in the
  // module where the intuitive reading of the operator is backwards.
  if (current.position < previous.position) return "up";
  if (current.position > previous.position) return "down";
  return "level";
}

/**
 * Rows in the order they will be drawn.
 *
 * Sorted by the competition's own `position`, never re-derived from points and
 * goal difference. Competitions break ties differently — head-to-head in Spain
 * and Italy, goal difference in England, goals scored before goal difference
 * in the Netherlands — and re-sorting here would substitute one competition's
 * rules for another's while looking authoritative. The same reasoning the top
 * scorers panel already applies to the provider's `rank`.
 *
 * A row with no position at all sorts last, keeping the order it arrived in,
 * and renders its position cell empty.
 */
function byStatedPosition(left: StandingsTableRow, right: StandingsTableRow): number {
  if (left.position === null && right.position === null) return 0;
  if (left.position === null) return 1;
  if (right.position === null) return -1;
  return left.position - right.position;
}

const UNGROUPED_KEY = "__ungrouped__";

/**
 * The finished table: every row derived, split into the competition's own
 * groups, each group sorted by stated position.
 *
 * Groups keep the order their first row appeared in, which for a table read
 * back position-ascending is A, B, C — the competition's own order, not an
 * alphabetical sort that would be wrong the moment a competition names its
 * groups anything else.
 */
export function buildStandingsGroups({
  rows,
  snapshotsByTeamId = new Map<string, StandingsSnapshotRow[]>(),
  formByTeamId = new Map<string, FormResult[]>(),
}: {
  rows: StandingsSourceRow[];
  /** Newest-first snapshots per team. Absent teams simply get no movement. */
  snapshotsByTeamId?: Map<string, StandingsSnapshotRow[]>;
  /** Newest-first W/D/L per team, already windowed. */
  formByTeamId?: Map<string, FormResult[]>;
}): StandingsGroup[] {
  const groups = new Map<string, StandingsGroup>();

  for (const row of rows) {
    const built: StandingsTableRow = {
      teamId: row.teamId,
      team: row.team,
      position: row.position,
      played: row.played,
      won: row.won,
      drawn: row.drawn,
      lost: row.lost,
      goalsFor: row.goalsFor,
      goalsAgainst: row.goalsAgainst,
      goalDifference: row.goalsFor - row.goalsAgainst,
      points: row.points,
      zone: classifyStandingsZone(row.zoneDescription),
      movement: movementSinceLastPlayed(row, snapshotsByTeamId.get(row.teamId) ?? []),
      form: formByTeamId.get(row.teamId) ?? [],
    };

    const label = row.groupLabel?.trim() || null;
    const key = label ?? UNGROUPED_KEY;
    const existing = groups.get(key);
    if (existing) existing.rows.push(built);
    else groups.set(key, { key, label, rows: [built] });
  }

  for (const group of groups.values()) group.rows.sort(byStatedPosition);

  return [...groups.values()];
}
