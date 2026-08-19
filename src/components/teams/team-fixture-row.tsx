import Link from "next/link";
import { TeamCrest } from "@/components/ui/team-crest";
import { competitionName } from "@/lib/football/competition-label";
import { formatKickoff, isLiveStatus, STATUS_LABEL, type FixtureStatus } from "@/lib/football/fixture-status";
import { resultFor, type FormResult } from "@/lib/football/results";

/**
 * One match, seen from one club's side.
 *
 * ## Why this is not `MatchListRow`
 *
 * `src/components/matches/match-list.tsx` is KIVO's one neutral match row and
 * every neutral list uses it. A club's own fixture list is not neutral: the
 * reader already knows one of the two teams, and repeating it on every row for
 * twenty rows is the single biggest waste of width on the page. What they need
 * instead is the three things a club's results column has carried in print for
 * a century — home or away, who against, and how it went.
 *
 * So the row is team-relative on purpose, and it uses `MatchList` (the shared
 * surface from match-list.tsx) as its container so the club page's list and
 * `/matches`' list are the same object with the same corners, the same
 * dividers and the same hairlines. Only the row's contents differ, because
 * only the row's contents should.
 *
 * `docs/UI_PRIMITIVES.md` says fixtures use `MatchListRow` and not to build a
 * fifth fixture row. This is the documented exception and it is narrow: the
 * shared row is neutral because `/matches` and `/live` have no "our" side, and
 * a club's own results column does. Everything else about it — the surface,
 * the row shape, the 44px target, the time rail's width — is the shared one's.
 *
 * ## Nothing here is invented
 *
 * A fixture with a null score renders no score. A fixture that is not finished
 * gets no W/D/L letter. The venue rail says H or A from the real
 * `home_team_id`, and says nothing at all if this club is somehow on neither
 * side of the fixture.
 */
export type TeamFixture = {
  id: string;
  kickoff_at: string;
  status: FixtureStatus;
  home_score: number | null;
  away_score: number | null;
  minute_elapsed?: number | null;
  competition: { name: string; short_name: string | null } | null;
  home_team: { id: string; name: string; short_name: string | null; crest_url: string | null } | null;
  away_team: { id: string; name: string; short_name: string | null; crest_url: string | null } | null;
};

const RESULT_CLASS: Record<FormResult, string> = {
  W: "text-live",
  D: "text-foreground-muted",
  L: "text-critical",
};

const RESULT_CHIP: Record<FormResult, string> = {
  W: "border-live/30 bg-live/10 text-live",
  D: "border-hairline bg-surface-2 text-foreground-muted",
  L: "border-critical/30 bg-critical/10 text-critical",
};

/** Short forms for the narrow time rail — the same abbreviations
 * `MatchList`'s own rail uses, for the same reason: "Postponed" does not fit
 * in a 44px column and "Postp." does. */
const RAIL_LABEL: Partial<Record<FixtureStatus, string>> = {
  finished: "FT",
  halftime: "HT",
  postponed: "Postp.",
  cancelled: "Canc.",
  abandoned: "Aband.",
};

export function teamFixtureResult(fixture: TeamFixture, teamId: string): FormResult | null {
  if (fixture.status !== "finished") return null;
  if (fixture.home_score === null || fixture.away_score === null) return null;
  const isHome = fixture.home_team?.id === teamId;
  const isAway = fixture.away_team?.id === teamId;
  if (!isHome && !isAway) return null;
  return resultFor(
    isHome ? fixture.home_score : fixture.away_score,
    isHome ? fixture.away_score : fixture.home_score,
  );
}

export function TeamFixtureRow({ fixture, teamId }: { fixture: TeamFixture; teamId: string }) {
  const isHome = fixture.home_team?.id === teamId;
  const isAway = fixture.away_team?.id === teamId;
  const opponent = isHome ? fixture.away_team : fixture.home_team;
  const live = isLiveStatus(fixture.status);
  const result = teamFixtureResult(fixture, teamId);
  const hasScore = fixture.home_score !== null && fixture.away_score !== null;

  // Own score first, always. A club's results column reads "2–1" as "we scored
  // two"; printing the home side first would silently flip that meaning on
  // every away match.
  const ownScore = isHome ? fixture.home_score : fixture.away_score;
  const oppScore = isHome ? fixture.away_score : fixture.home_score;

  const railLabel = live
    ? fixture.status === "halftime"
      ? "HT"
      : fixture.minute_elapsed != null
        ? `${fixture.minute_elapsed}'`
        : "Live"
    : fixture.status === "scheduled"
      ? formatKickoff(fixture.kickoff_at)
      : (RAIL_LABEL[fixture.status] ?? STATUS_LABEL[fixture.status]);

  const competition = competitionName(fixture.competition, "short");
  const opponentName = opponent?.name ?? "Opponent";

  return (
    <li className="relative">
      <Link
        href={`/matches/${fixture.id}`}
        aria-label={`${isHome ? "Home" : "Away"} against ${opponentName}, match centre`}
        className="kivo-focus flex min-h-11 items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-surface-2 motion-reduce:transition-none"
      >
        <div className="flex w-11 shrink-0 flex-col items-center gap-1">
          <span
            className={`text-[11px] font-semibold tabular-nums leading-none ${live ? "text-live" : "text-foreground-subtle"}`}
          >
            {railLabel}
          </span>
          {live ? (
            <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full rounded-full bg-live opacity-75 motion-safe:animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-live" />
            </span>
          ) : (
            (isHome || isAway) && (
              <span className="text-[11px] font-semibold uppercase tracking-wider leading-none text-foreground-subtle">
                {isHome ? "H" : "A"}
              </span>
            )
          )}
        </div>

        <TeamCrest crestUrl={opponent?.crest_url ?? null} name={opponentName} size={22} />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-foreground">{opponentName}</p>
          {competition && <p className="truncate text-[11px] text-foreground-subtle">{competition}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {hasScore && ownScore !== null && oppScore !== null && (
            <span className={`text-sm font-semibold tabular-nums ${result ? RESULT_CLASS[result] : "text-foreground"}`}>
              {ownScore}–{oppScore}
            </span>
          )}
          {/* The letter, not just the colour — green and red alone are
              indistinguishable to a colour-blind reader, and an aria-label
              would only fix it for a screen reader. */}
          {result && (
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-bold ${RESULT_CHIP[result]}`}
            >
              {result}
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}
