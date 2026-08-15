export type FormResult = "W" | "D" | "L";

/**
 * Win/draw/loss for one side of a finished fixture, given both final scores
 * from that side's own perspective (already resolved to "own" vs "opponent"
 * by the caller, which knows which side is home/away). Was computed three
 * near-identical times before this consolidation: `teams/[id]`'s
 * FixtureListItem (for result colouring), `teams/compare`'s
 * getTeamCompareData (for its form strip), and now the new form strip and
 * goal/discipline stats added by RECOMMENDATIONS.md items 160-164.
 */
export function resultFor(ownScore: number, oppScore: number): FormResult {
  if (ownScore > oppScore) return "W";
  if (ownScore < oppScore) return "L";
  return "D";
}
