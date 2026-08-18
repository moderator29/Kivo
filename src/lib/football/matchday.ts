/**
 * Turning a provider's round label into `fixtures.matchday`.
 *
 * KN-84 describes `matchday` as "synced and never used". Reading the code, the
 * first half was not true either: the column has existed since migration 0001
 * with a doc comment promising a "round/gameweek number within the
 * competition", and **nothing has ever written to it** — no normalizer read the
 * provider's round, and `upsert_fixture_with_mapping` did not carry it. It was
 * a column, a comment and an intention.
 *
 * API-Football reports rounds as free text: "Regular Season - 12",
 * "Group Stage - 2", "Round of 16", "Quarter-finals", "Final". Only some of
 * those contain a matchday number, and that is the whole difficulty.
 *
 * The rule this module holds to: **a round with no number in it produces null,
 * never a guess.** Numbering knockout rounds 1..N would fabricate an ordering
 * the competition does not have, and every consumer downstream — a matchday
 * navigator, a form guide, fantasy gameweeks — would then present that
 * invention as fact. Null means "this fixture does not belong to a numbered
 * matchday", which is the truth about a cup quarter-final.
 */

/**
 * The matchday number in a provider round label, or null when there isn't one.
 *
 * Matches a trailing integer, optionally after a separator, which is the shape
 * every numbered API-Football round takes. Deliberately anchored to the end:
 * "Round of 16" must not yield 16, because 16 is a number of *teams*, not a
 * matchday — and it is the single most tempting wrong answer here.
 */
export function parseMatchday(round: string | null | undefined): number | null {
  if (typeof round !== "string") return null;

  const trimmed = round.trim();
  if (trimmed.length === 0) return null;

  // "Round of 16", "Last 32" — a count of teams, not a matchday. Rejected
  // explicitly and before the number match, because the generic pattern below
  // would otherwise happily read the 16.
  if (/\b(round of|last)\s+\d+\s*$/i.test(trimmed)) return null;

  // A separator is required: "Regular Season - 12" and "Matchday 12" are
  // matchdays, "Final" is not, and a bare "12" from a provider that changed its
  // format is too ambiguous to accept silently.
  const match = /(?:[-–—:]\s*|\b(?:matchday|round|week|gameweek|jornada|spieltag)\s+)(\d{1,3})\s*$/i.exec(trimmed);
  if (!match) return null;

  const value = Number(match[1]);
  // `fixtures.matchday` is a smallint, and no real competition has a 999th
  // matchday — a value outside this range means the label was not what this
  // function assumed, so the honest answer is null rather than a bad number.
  if (!Number.isInteger(value) || value < 1 || value > 200) return null;

  return value;
}
