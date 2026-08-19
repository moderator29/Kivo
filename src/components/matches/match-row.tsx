import { MatchList, MatchListRow, type MatchListFixture } from "@/components/matches/match-list";
import { competitionName } from "@/lib/football/competition-label";

export type MatchRowFixture = MatchListFixture & {
  competition: { name: string; short_name: string | null } | null;
};

/**
 * A fixture list for a surface with no competition grouping of its own — a
 * venue's matches, where every row can be a different competition and there is
 * no group header above to name it.
 *
 * FRONTEND SWEEP: this used to be a standalone `kivo-glass rounded-2xl p-4` card
 * per fixture, which is the shape `MatchList` exists to replace. It is now the
 * same rows every other match list uses, in the same surface, with the
 * competition carried as the row's meta line rather than as a separate header —
 * because on this surface the competition genuinely varies per row, which is the
 * one case where per-row labelling earns its space.
 */
export function MatchRowList({ fixtures }: { fixtures: MatchRowFixture[] }) {
  return (
    <MatchList>
      {fixtures.map((fixture) => (
        <MatchListRow
          key={fixture.id}
          fixture={fixture}
          meta={
            competitionName(fixture.competition, "short") ? (
              <span className="text-[11px] text-foreground-subtle">
                {competitionName(fixture.competition, "short")}
              </span>
            ) : undefined
          }
        />
      ))}
    </MatchList>
  );
}
