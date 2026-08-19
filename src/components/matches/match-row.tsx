import Link from "next/link";
import { TeamCrest } from "@/components/ui/team-crest";
import { competitionName } from "@/lib/football/competition-label";
import { FixtureStatusBadge } from "@/components/matches/fixture-status-badge";
import type { Database } from "@/lib/supabase/types";

type FixtureStatus = Database["public"]["Enums"]["fixture_status"];

export type MatchRowFixture = {
  id: string;
  kickoff_at: string;
  status: FixtureStatus;
  home_score: number | null;
  away_score: number | null;
  competition: { name: string; short_name: string | null } | null;
  home_team: { id: string; name: string; crest_url: string | null } | null;
  away_team: { id: string; name: string; crest_url: string | null } | null;
};

/**
 * A team-neutral match row: both sides shown as home/away, not relative to
 * "my team" the way `teams/[id]`'s FixtureListItem is. Extracted from
 * `/matches`' own card (RECOMMENDATIONS.md item 166's venue detail page
 * needed the exact same shape — a fixture list with no single team's
 * perspective to hang "H"/"A" or a win/loss colour off).
 */
export function MatchRow({ fixture }: { fixture: MatchRowFixture }) {
  const hasScore = fixture.home_score !== null && fixture.away_score !== null;

  return (
    <div className="kivo-glass relative rounded-2xl p-4 transition hover:-translate-y-0.5 hover:bg-surface-2">
      <Link
        href={`/matches/${fixture.id}`}
        className="absolute inset-0 z-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        aria-label={`${fixture.home_team?.name ?? "Home team"} vs ${fixture.away_team?.name ?? "Away team"}, match centre`}
      />
      <div className="relative z-0 mb-2 flex items-center justify-between">
        {/* Nothing at all when KIVO has no name for the competition. The
            previous "Unknown competition" sat in the exact slot a league's
            name sits in, so it read as the name. */}
        <span className="min-w-0 truncate text-xs text-foreground-subtle">
          {competitionName(fixture.competition, "short")}
        </span>
        <FixtureStatusBadge status={fixture.status} kickoffAt={fixture.kickoff_at} includeWeekday />
      </div>
      <div className="relative z-0 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 rounded-full p-0.5 ring-1 ring-hairline">
            <TeamCrest crestUrl={fixture.home_team?.crest_url ?? null} name={fixture.home_team?.name ?? "Home"} />
          </span>
          {fixture.home_team?.id ? (
            <Link
              href={`/teams/${fixture.home_team.id}`}
              className="relative z-10 line-clamp-2 break-words text-sm text-foreground hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {fixture.home_team.name}
            </Link>
          ) : (
            <span className="line-clamp-2 break-words text-sm text-foreground">{fixture.home_team?.name ?? "Home team"}</span>
          )}
        </div>
        <span className={hasScore ? "shrink-0 text-base font-bold tabular-nums text-foreground" : "shrink-0 text-sm font-semibold text-foreground-subtle"}>
          {hasScore ? `${fixture.home_score} – ${fixture.away_score}` : "vs"}
        </span>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          {fixture.away_team?.id ? (
            <Link
              href={`/teams/${fixture.away_team.id}`}
              className="relative z-10 line-clamp-2 break-words text-right text-sm text-foreground hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {fixture.away_team.name}
            </Link>
          ) : (
            <span className="line-clamp-2 break-words text-right text-sm text-foreground">{fixture.away_team?.name ?? "Away team"}</span>
          )}
          <span className="shrink-0 rounded-full p-0.5 ring-1 ring-hairline">
            <TeamCrest crestUrl={fixture.away_team?.crest_url ?? null} name={fixture.away_team?.name ?? "Away"} />
          </span>
        </div>
      </div>
    </div>
  );
}
