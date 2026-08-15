import Link from "next/link";
import { TeamCrest } from "@/components/ui/team-crest";
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
    <div className="kivo-glass relative rounded-2xl p-4 transition hover:-translate-y-0.5 hover:bg-white/[0.06]">
      <Link
        href={`/matches/${fixture.id}`}
        className="absolute inset-0 z-0 rounded-2xl"
        aria-label={`${fixture.home_team?.name ?? "Home team"} vs ${fixture.away_team?.name ?? "Away team"}, match centre`}
      />
      <div className="relative z-0 mb-2 flex items-center justify-between">
        <span className="text-xs text-foreground-subtle">
          {fixture.competition?.short_name ?? fixture.competition?.name ?? "Unknown competition"}
        </span>
        <FixtureStatusBadge status={fixture.status} kickoffAt={fixture.kickoff_at} includeWeekday />
      </div>
      <div className="relative z-0 flex items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2">
          <TeamCrest crestUrl={fixture.home_team?.crest_url ?? null} name={fixture.home_team?.name ?? "Home"} />
          {fixture.home_team?.id ? (
            <Link
              href={`/teams/${fixture.home_team.id}`}
              className="relative z-10 truncate text-sm text-foreground hover:text-kivo-cyan"
            >
              {fixture.home_team.name}
            </Link>
          ) : (
            <span className="truncate text-sm text-foreground">{fixture.home_team?.name ?? "Home team"}</span>
          )}
        </div>
        <span className="shrink-0 text-sm font-semibold text-foreground">
          {hasScore ? `${fixture.home_score} – ${fixture.away_score}` : "vs"}
        </span>
        <div className="flex flex-1 items-center justify-end gap-2">
          {fixture.away_team?.id ? (
            <Link
              href={`/teams/${fixture.away_team.id}`}
              className="relative z-10 truncate text-right text-sm text-foreground hover:text-kivo-cyan"
            >
              {fixture.away_team.name}
            </Link>
          ) : (
            <span className="truncate text-right text-sm text-foreground">{fixture.away_team?.name ?? "Away team"}</span>
          )}
          <TeamCrest crestUrl={fixture.away_team?.crest_url ?? null} name={fixture.away_team?.name ?? "Away"} />
        </div>
      </div>
    </div>
  );
}
