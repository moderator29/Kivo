/**
 * A plain module, deliberately.
 *
 * This used to be exported from `match-overview.tsx`, which carries
 * `"use client"`. Importing a function out of a client module and calling it
 * from a Server Component does not merely feel wrong — every export of such a
 * module becomes a client reference, and calling one on the server throws at
 * request time, on a page that type-checks and builds perfectly. The Match
 * Centre's hero is server-rendered and needs this string, so the function
 * moved to where both sides can genuinely reach it.
 */

/**
 * How a fixture's round reads on screen.
 *
 * Two columns hold two different facts and neither replaces the other:
 * `round_label` is the provider's own string ("Regular Season - 12",
 * "Quarter-finals") and `matchday` is the number parsed out of it, which is
 * null for any round that has none.
 *
 * The label wins when there is one, because it is what the competition calls
 * the round. But API-Football's league labels are machine-shaped — "Regular
 * Season - 12" is not how anyone says it — so that one exact shape is rewritten
 * to "Matchday 12" and every other label is passed through untouched. Narrow on
 * purpose: a rewrite that tried to prettify arbitrary labels would eventually
 * mangle a real round name, and "Quarter-finals" needs no help.
 */
export function roundText(facts: { roundLabel: string | null; matchday: number | null }): string | null {
  const label = facts.roundLabel?.trim();
  if (label) {
    const regularSeason = /^regular season\s*-\s*(\d+)$/i.exec(label);
    if (regularSeason) return `Matchday ${regularSeason[1]}`;
    return label;
  }
  return facts.matchday !== null ? `Matchday ${facts.matchday}` : null;
}
