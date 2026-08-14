import type { Metadata } from "next";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { FadeIn } from "@/components/ui/fade-in";
import { ComingSoon } from "@/components/ui/coming-soon";
import { TeamCrest } from "@/components/ui/team-crest";
import { FixtureStatusBadge } from "@/components/matches/fixture-status-badge";
import { NAV_ITEMS } from "@/lib/navigation";

const item = NAV_ITEMS.find((i) => i.id === "matches")!;

export const metadata: Metadata = { title: item.label };

export default async function MatchesPage() {
  const supabase = createServerSupabaseClient();

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

  const { data: fixtures } = await supabase
    .from("fixtures")
    .select(
      `id, kickoff_at, status, home_score, away_score,
       home_team:teams!fixtures_home_team_id_fkey(id, name, short_name, crest_url),
       away_team:teams!fixtures_away_team_id_fkey(id, name, short_name, crest_url),
       competition:competitions(name, short_name)`,
    )
    .gte("kickoff_at", startOfDay.toISOString())
    .lt("kickoff_at", endOfDay.toISOString())
    .order("kickoff_at", { ascending: true });

  if (!fixtures || fixtures.length === 0) {
    return (
      <ComingSoon icon={<item.icon className="h-9 w-9 text-kivo-white" strokeWidth={1.75} />} image={item.comingSoonImage} title={item.label} description={item.comingSoonDescription ?? "Check back soon."} />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn>
        <h1 className="text-xl font-semibold text-foreground">Matches</h1>
        <p className="text-sm text-foreground-muted">Today&apos;s fixtures, synced from API-Football.</p>
      </FadeIn>

      <div className="flex flex-col gap-2">
        {fixtures.map((fixture, index) => {
          const hasScore = fixture.home_score !== null && fixture.away_score !== null;
          return (
            <FadeIn key={fixture.id} delay={Math.min(index * 0.03, 0.3)} className="kivo-glass rounded-2xl p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-foreground-subtle">
                  {fixture.competition?.short_name ?? fixture.competition?.name ?? "Unknown competition"}
                </span>
                <FixtureStatusBadge status={fixture.status} kickoffAt={fixture.kickoff_at} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-1 items-center gap-2">
                  <TeamCrest crestUrl={fixture.home_team?.crest_url ?? null} name={fixture.home_team?.name ?? "Home"} />
                  {fixture.home_team?.id ? (
                    <Link
                      href={`/teams/${fixture.home_team.id}`}
                      className="truncate text-sm text-foreground hover:text-kivo-cyan"
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
                      className="truncate text-right text-sm text-foreground hover:text-kivo-cyan"
                    >
                      {fixture.away_team.name}
                    </Link>
                  ) : (
                    <span className="truncate text-right text-sm text-foreground">{fixture.away_team?.name ?? "Away team"}</span>
                  )}
                  <TeamCrest crestUrl={fixture.away_team?.crest_url ?? null} name={fixture.away_team?.name ?? "Away"} />
                </div>
              </div>
            </FadeIn>
          );
        })}
      </div>
    </div>
  );
}
