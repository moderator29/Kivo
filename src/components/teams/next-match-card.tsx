import Link from "next/link";
import { CalendarClock, ChevronRight } from "lucide-react";
import { TeamCrest } from "@/components/ui/team-crest";
import { LeadCountdown } from "@/components/home/lead-countdown";
import { competitionName } from "@/lib/football/competition-label";
import { isLiveStatus } from "@/lib/football/fixture-status";
import { formatDateTime } from "@/lib/format";
import type { TeamFixture } from "@/components/teams/team-fixture-row";

/**
 * The next match. On a club page this is *the* thing the reader came for, and
 * on the old page it was the seventh section down, in a list of ten identical
 * rows, below the manager and the goal-timing distribution.
 *
 * Every reference product gives a club's next fixture its own block above the
 * fold, and they all say the same four things: which competition, when, who
 * against, and home or away. This says those four and stops. There is no
 * predicted score, no "form guide" verdict and no odds — none of which KIVO
 * holds, and any of which would be an invention dressed as analysis.
 *
 * When the match is already under way this becomes the live scoreline instead,
 * because at that moment "in 0m" is not what anyone wants to read.
 */
export function NextMatchCard({
  fixture,
  teamId,
  venueName,
}: {
  fixture: TeamFixture;
  teamId: string;
  /** This club's own ground, used only to name where a HOME match is played.
   * An away match's venue is the opponent's ground, which KIVO does not read
   * here, so it simply says nothing rather than naming the wrong stadium. */
  venueName?: string | null;
}) {
  const isHome = fixture.home_team?.id === teamId;
  const opponent = isHome ? fixture.away_team : fixture.home_team;
  const own = isHome ? fixture.home_team : fixture.away_team;
  const live = isLiveStatus(fixture.status);
  const competition = competitionName(fixture.competition, "full");
  const hasScore = fixture.home_score !== null && fixture.away_score !== null;

  return (
    <Link
      href={`/matches/${fixture.id}`}
      className="kivo-glass kivo-glass-interactive kivo-focus group flex flex-col gap-4 rounded-2xl p-5 transition-all hover:-translate-y-0.5"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          {live ? (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-live">
              <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full rounded-full bg-live opacity-75 motion-safe:animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-live" />
              </span>
              Live
            </span>
          ) : (
            <CalendarClock className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />
          )}
          <span className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
            {competition ?? "Next match"}
          </span>
        </span>
        <span className="shrink-0 rounded-full border border-hairline px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-foreground-muted">
          {isHome ? "Home" : "Away"}
        </span>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
          <TeamCrest crestUrl={own?.crest_url ?? null} name={own?.name ?? "This club"} size={40} />
          <span className="line-clamp-2 text-center text-xs font-medium text-foreground">
            {own?.short_name ?? own?.name ?? "This club"}
          </span>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-1 px-1">
          {live && hasScore ? (
            <span className="text-2xl font-semibold tabular-nums text-foreground">
              {isHome ? fixture.home_score : fixture.away_score}
              <span className="px-1 text-foreground-subtle">–</span>
              {isHome ? fixture.away_score : fixture.home_score}
            </span>
          ) : (
            <>
              <span className="text-lg font-semibold tabular-nums text-foreground">
                {formatDateTime(fixture.kickoff_at, "time")}
              </span>
              <span className="text-[11px] text-foreground-subtle">
                {formatDateTime(fixture.kickoff_at, "dayMonth")}
              </span>
            </>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
          <TeamCrest crestUrl={opponent?.crest_url ?? null} name={opponent?.name ?? "Opponent"} size={40} />
          <span className="line-clamp-2 text-center text-xs font-medium text-foreground">
            {opponent?.short_name ?? opponent?.name ?? "Opponent"}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-hairline-soft pt-3">
        <span className="min-w-0 truncate text-[11px] text-foreground-subtle">
          {live ? (
            "Match Centre is live"
          ) : isHome && venueName ? (
            venueName
          ) : (
            <>
              Kicks off in{" "}
              <LeadCountdown iso={fixture.kickoff_at} passedLabel="moments" className="tabular-nums text-foreground-muted" />
            </>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-accent">
          Match Centre
          <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
        </span>
      </div>
    </Link>
  );
}
