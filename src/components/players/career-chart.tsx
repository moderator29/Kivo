import type { CareerSeason } from "@/components/players/player-career";

/**
 * A player's output, season by season.
 *
 * ## Why a bar and not a line
 *
 * A line implies the value between two points means something. Between two
 * seasons it does not: nobody scored 6.5 goals in the summer. Bars, one per
 * season, are the honest shape — and horizontal bars specifically, because a
 * phone has far more room for a season label beside a bar than under a column.
 *
 * ## What is drawn, and what is not
 *
 * Goals and assists, from `player_season_statistics`, and only where the
 * provider actually reported them. A season that reported neither is still
 * listed — leaving it out would silently close a gap in a career — but it is
 * listed with a dash and no bar, which is what "not reported" looks like.
 *
 * The scale is shared across every season and stated once, so two bars can be
 * compared by eye. Nothing is normalised per row, which is the trick that makes
 * a chart look impressive and say nothing.
 */
export function CareerChart({ seasons }: { seasons: CareerSeason[] }) {
  const max = Math.max(
    1,
    ...seasons.map((season) => (season.goals ?? 0) + (season.assists ?? 0)),
  );

  return (
    <div className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
      <div className="flex items-center gap-4 text-[11px] text-foreground-subtle">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
          Goals
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-kivo-violet" />
          Assists
        </span>
      </div>

      <ul className="flex flex-col gap-2.5">
        {seasons.map((season) => {
          const goals = season.goals;
          const assists = season.assists;
          const reported = goals !== null || assists !== null;
          const label = `${season.seasonYear}/${String((season.seasonYear + 1) % 100).padStart(2, "0")}`;

          return (
            <li key={season.seasonYear} className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-[11px] tabular-nums text-foreground-subtle">{label}</span>
              <span className="flex h-2.5 min-w-0 flex-1 items-stretch gap-px overflow-hidden rounded-full bg-surface-track">
                {/* The container is already rounded and clipping, so the
                    segments stay square and the bar's ends come from the
                    track — two segments each rounding their own corners would
                    leave a notch between them. */}
                {goals !== null && goals > 0 && (
                  <span className="bg-accent" style={{ width: `${(goals / max) * 100}%` }} />
                )}
                {assists !== null && assists > 0 && (
                  <span className="bg-kivo-violet" style={{ width: `${(assists / max) * 100}%` }} />
                )}
              </span>
              <span className="w-24 shrink-0 whitespace-nowrap text-right text-[11px] font-semibold tabular-nums text-foreground">
                {reported ? (
                  <>
                    {goals ?? "–"}
                    <span className="font-normal text-foreground-subtle"> G · </span>
                    {assists ?? "–"}
                    <span className="font-normal text-foreground-subtle"> A</span>
                  </>
                ) : (
                  <span className="font-normal text-foreground-subtle">Not reported</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="text-[11px] leading-relaxed text-foreground-subtle">
        Every competition the season was reported in, added together. A season with a dash was reported without goal or
        assist figures — it is not a season without goals.
      </p>
    </div>
  );
}
