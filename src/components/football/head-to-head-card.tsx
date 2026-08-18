import { Swords } from "lucide-react";
import type { HeadToHeadRecord } from "@/lib/football/head-to-head";

// RECOMMENDATIONS.md item 161: "if KIVO has fewer than, say, 3 synced
// meetings, say exactly how many it has rather than presenting a thin
// sample as if it were a real record."
const MIN_MEANINGFUL_SAMPLE = 3;

type TeamRef = { name: string; shortName: string | null };

/**
 * Real head-to-head record between two teams, computed by getHeadToHead()
 * from finished `fixtures` rows only. Shared by Match Centre (embedded on
 * the fixture page, prior meetings only) and `/teams/compare` (the smallest
 * useful "team pages" surface for this — see the comment above its call
 * site for why a dedicated per-rival widget wasn't built).
 */
export function HeadToHeadCard({ teamA, teamB, record }: { teamA: TeamRef; teamB: TeamRef; record: HeadToHeadRecord }) {
  const total = record.meetings.length;

  return (
    <div className="kivo-glass flex flex-col gap-4 rounded-2xl p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
        <Swords className="h-4 w-4 text-accent" strokeWidth={1.75} />
        Head to head
      </h2>

      {total === 0 ? (
        <p className="text-sm text-foreground-muted">
          KIVO has no synced meetings yet between {teamA.name} and {teamB.name}.
        </p>
      ) : total < MIN_MEANINGFUL_SAMPLE ? (
        <p className="text-sm text-foreground-muted">
          KIVO has synced only {total} meeting{total === 1 ? "" : "s"} between {teamA.name} and {teamB.name} so far
          ({record.teamAWins}-{record.draws}-{record.teamBWins}). Too few to call a real record.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-surface-1 px-2 py-2">
              <div className="text-2xl font-bold text-foreground">{record.teamAWins}</div>
              <div className="truncate text-[11px] uppercase tracking-wide text-foreground-subtle">
                {teamA.shortName ?? teamA.name} wins
              </div>
            </div>
            <div className="rounded-xl bg-surface-1 px-2 py-2">
              <div className="text-2xl font-bold text-foreground">{record.draws}</div>
              <div className="text-[11px] uppercase tracking-wide text-foreground-subtle">Draws</div>
            </div>
            <div className="rounded-xl bg-surface-1 px-2 py-2">
              <div className="text-2xl font-bold text-foreground">{record.teamBWins}</div>
              <div className="truncate text-[11px] uppercase tracking-wide text-foreground-subtle">
                {teamB.shortName ?? teamB.name} wins
              </div>
            </div>
          </div>
          <p className="text-center text-xs text-foreground-subtle">
            Aggregate score {record.teamAGoals}-{record.teamBGoals}, from {total} synced meeting
            {total === 1 ? "" : "s"}.
          </p>
        </>
      )}
    </div>
  );
}
