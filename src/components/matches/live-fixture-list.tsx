"use client";

import Link from "next/link";
import { TeamCrest } from "@/components/ui/team-crest";
import { FixtureStatusBadge } from "@/components/matches/fixture-status-badge";
import { isLiveStatus } from "@/lib/football/fixture-status";
import { groupFixturesByCompetition } from "@/lib/football/group-by-competition";
import { useRealtimeFixtures } from "@/hooks/use-realtime-fixtures";
import type { Database } from "@/lib/supabase/types";

type FixtureStatus = Database["public"]["Enums"]["fixture_status"];

export type LiveListFixture = {
  id: string;
  kickoff_at: string;
  status: FixtureStatus;
  home_score: number | null;
  away_score: number | null;
  minute_elapsed: number | null;
  home_team: { name: string; crest_url: string | null } | null;
  away_team: { name: string; crest_url: string | null } | null;
  competition: { id: string | null; name: string; short_name: string | null } | null;
};

/**
 * Client half of the "Live now" / "Today's fixtures" list on /live: takes
 * the server-fetched rows as the initial paint (so the page still SSRs and
 * works with JS disabled), then layers real-time score/status/minute
 * updates on top via useRealtimeFixtures. Was previously two plain
 * functions inside the server component itself — pulled out here because
 * only this part needs to be a Client Component; the page's data fetching
 * and empty-state logic stay server-side.
 */
export function LiveFixtureList({ fixtures }: { fixtures: LiveListFixture[] }) {
  const liveFixtures = useRealtimeFixtures(fixtures);
  const groups = groupFixturesByCompetition(liveFixtures);

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.competitionId ?? group.competitionName} className="flex flex-col gap-1">
          <div className="flex items-center justify-between px-2">
            {group.competitionId ? (
              <Link
                href={`/leagues/${group.competitionId}`}
                className="text-xs font-semibold text-foreground-muted transition hover:text-kivo-cyan"
              >
                {group.competitionName}
              </Link>
            ) : (
              <span className="text-xs font-semibold text-foreground-muted">{group.competitionName}</span>
            )}
            <span className="text-[11px] text-foreground-subtle">
              {group.fixtures.length} {group.fixtures.length === 1 ? "fixture" : "fixtures"}
            </span>
          </div>
          <div className="flex flex-col divide-y divide-white/5">
            {group.fixtures.map((fixture) => (
              <FixtureRowCard key={fixture.id} fixture={fixture} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FixtureRowCard({ fixture }: { fixture: LiveListFixture }) {
  const hasScore = fixture.home_score !== null && fixture.away_score !== null;
  const live = isLiveStatus(fixture.status);

  return (
    <Link
      href={`/matches/${fixture.id}`}
      className="flex flex-col gap-2 rounded-xl px-2 py-2 transition hover:bg-white/5"
    >
      <div className="flex items-center justify-end">
        <FixtureStatusBadge
          status={fixture.status}
          kickoffAt={fixture.kickoff_at}
          showLiveDot={false}
          minuteElapsed={fixture.minute_elapsed}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2">
          <TeamCrest crestUrl={fixture.home_team?.crest_url ?? null} name={fixture.home_team?.name ?? "Home"} />
          <span className="truncate text-sm text-foreground">{fixture.home_team?.name ?? "Home team"}</span>
        </div>
        <span className={`shrink-0 text-sm font-semibold ${live ? "text-live" : "text-foreground"}`}>
          {hasScore ? `${fixture.home_score} – ${fixture.away_score}` : "vs"}
        </span>
        <div className="flex flex-1 items-center justify-end gap-2">
          <span className="truncate text-right text-sm text-foreground">{fixture.away_team?.name ?? "Away team"}</span>
          <TeamCrest crestUrl={fixture.away_team?.crest_url ?? null} name={fixture.away_team?.name ?? "Away"} />
        </div>
      </div>
    </Link>
  );
}
