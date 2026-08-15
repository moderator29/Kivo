/**
 * Groups an already-fetched list of fixtures by their real competition —
 * pure client/server-side grouping of data the caller already has (no new
 * provider or DB call), shared by /live and /matches (RECOMMENDATIONS-style
 * item: "group fixture lists by competition with real match counts").
 * Preserves each group's first-appearance order rather than re-sorting, so
 * it stays consistent with whatever order the caller already fetched
 * (kickoff time, ascending).
 */
export type CompetitionGroup<TFixture> = {
  competitionId: string | null;
  competitionName: string;
  fixtures: TFixture[];
};

export function groupFixturesByCompetition<
  TFixture extends { competition: { id: string | null; name: string; short_name: string | null } | null },
>(fixtures: TFixture[]): CompetitionGroup<TFixture>[] {
  const groups: CompetitionGroup<TFixture>[] = [];
  const indexByKey = new Map<string, number>();

  for (const fixture of fixtures) {
    const competitionId = fixture.competition?.id ?? null;
    const competitionName = fixture.competition?.name ?? fixture.competition?.short_name ?? "Unknown competition";
    // Falls back to the display name as the grouping key on the rare row with
    // no competition id at all, so it still groups with same-named rows
    // instead of each getting its own singleton group.
    const key = competitionId ?? `name:${competitionName}`;

    const existingIndex = indexByKey.get(key);
    if (existingIndex !== undefined) {
      groups[existingIndex].fixtures.push(fixture);
      continue;
    }

    indexByKey.set(key, groups.length);
    groups.push({ competitionId, competitionName, fixtures: [fixture] });
  }

  return groups;
}
