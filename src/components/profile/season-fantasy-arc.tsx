import type { SeasonGameweek } from "@/lib/season-summary";

/**
 * A gameweek-by-gameweek fantasy arc, drawn from real `fantasy_points` rows.
 *
 * Deliberately a bar per gameweek rather than a line: a line implies the values
 * between two gameweeks mean something, and they do not — there is no fantasy
 * score halfway between gameweek 3 and gameweek 4. Bars say "these are the
 * scored gameweeks and nothing else is claimed", which is the truth.
 *
 * Scaled against this manager's own best gameweek rather than any external
 * maximum, because there is no honest external maximum: KIVO has no "typical"
 * fantasy score to compare against, and inventing one would be exactly the kind
 * of fabricated benchmark this product does not do. Every bar is labelled with
 * its real number, so the shape is a visual aid and the value is the fact.
 */
export function SeasonFantasyArc({ gameweeks }: { gameweeks: SeasonGameweek[] }) {
  const best = Math.max(...gameweeks.map((gw) => gw.points), 1);

  return (
    <div className="flex flex-col gap-2">
      <ol className="flex items-end gap-1.5 overflow-x-auto pb-1">
        {gameweeks.map((gw) => {
          // Floored at a visible sliver so a scored zero still reads as a
          // gameweek that happened, rather than vanishing into the axis.
          const heightPct = Math.max(6, Math.round((gw.points / best) * 100));
          return (
            <li
              key={`${gw.teamName}-${gw.gameweekNumber}`}
              className="flex min-w-[2.25rem] flex-1 flex-col items-center gap-1"
            >
              <span className="text-[11px] font-semibold text-foreground">{gw.points}</span>
              <div className="flex h-16 w-full items-end">
                <div
                  className="kivo-gradient-prime w-full rounded-t-md"
                  style={{ height: `${heightPct}%` }}
                  aria-hidden="true"
                />
              </div>
              <span className="text-[10px] text-foreground-subtle">GW{gw.gameweekNumber}</span>
            </li>
          );
        })}
      </ol>
      {gameweeks.length === 1 && (
        <p className="text-[11px] text-foreground-subtle">
          One scored gameweek so far — there is no arc to draw yet, just this.
        </p>
      )}
    </div>
  );
}
