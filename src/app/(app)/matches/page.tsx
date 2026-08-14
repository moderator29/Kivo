import type { Metadata } from "next";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { FadeIn } from "@/components/ui/fade-in";
import { TeamCrest } from "@/components/ui/team-crest";
import { FixtureStatusBadge } from "@/components/matches/fixture-status-badge";
import { MatchesDateStrip, dateKey, todayUtc } from "@/components/matches/date-strip";
import { NAV_ITEMS } from "@/lib/navigation";

const item = NAV_ITEMS.find((i) => i.id === "matches")!;

export const metadata: Metadata = { title: item.label };

const DATE_PARAM_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Resolves the `?date=` search param to a UTC day boundary, defaulting to
 * today when the param is missing or malformed (never trusting client input
 * for the DB range query below). */
function resolveSelectedDate(dateParam: string | undefined): Date {
  if (dateParam && DATE_PARAM_RE.test(dateParam)) {
    const parsed = new Date(`${dateParam}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return todayUtc();
}

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: dateParam } = await searchParams;
  const supabase = createServerSupabaseClient();

  const startOfDay = resolveSelectedDate(dateParam);
  const endOfDay = new Date(startOfDay);
  endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);
  const isToday = dateKey(startOfDay) === dateKey(todayUtc());

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

  const dateLabel = startOfDay.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn>
        <h1 className="text-xl font-semibold text-foreground">Matches</h1>
        <p className="text-sm text-foreground-muted">Fixtures synced from API-Football.</p>
      </FadeIn>

      <FadeIn delay={0.04}>
        <MatchesDateStrip selected={startOfDay} />
      </FadeIn>

      {!fixtures || fixtures.length === 0 ? (
        <FadeIn delay={0.08} className="kivo-glass flex flex-col items-center gap-2 rounded-2xl px-6 py-16 text-center">
          <p className="text-sm text-foreground-muted">
            No fixtures synced for {isToday ? "today" : dateLabel}.
          </p>
          <p className="max-w-xs text-xs text-foreground-subtle">
            Try another date above, or check back once KIVO&apos;s football data sync has run.
          </p>
        </FadeIn>
      ) : (
        <div className="flex flex-col gap-2">
          {fixtures.map((fixture, index) => {
            const hasScore = fixture.home_score !== null && fixture.away_score !== null;
            return (
              <FadeIn
                key={fixture.id}
                delay={Math.min(0.08 + index * 0.03, 0.35)}
                className="kivo-glass relative rounded-2xl p-4 transition hover:-translate-y-0.5 hover:bg-white/[0.06]"
              >
                {/* Stretched-link overlay: makes the whole card navigate to
                    Match Centre (item 110), matching Home's FixtureRow and
                    /live's cards, while the team-name links below stay
                    clickable to their team pages by sitting above this
                    overlay in stacking order (`relative z-10`) instead of
                    nesting a second interactive <a> inside this one. */}
                <Link
                  href={`/matches/${fixture.id}`}
                  className="absolute inset-0 z-0 rounded-2xl"
                  aria-label={`${fixture.home_team?.name ?? "Home team"} vs ${fixture.away_team?.name ?? "Away team"}, match centre`}
                />
                <div className="relative z-0 mb-2 flex items-center justify-between">
                  <span className="text-xs text-foreground-subtle">
                    {fixture.competition?.short_name ?? fixture.competition?.name ?? "Unknown competition"}
                  </span>
                  <FixtureStatusBadge status={fixture.status} kickoffAt={fixture.kickoff_at} />
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
              </FadeIn>
            );
          })}
        </div>
      )}
    </div>
  );
}
