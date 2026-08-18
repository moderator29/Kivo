import type { Metadata } from "next";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { FadeIn } from "@/components/ui/fade-in";
import { TeamCrest } from "@/components/ui/team-crest";
import { FixtureStatusBadge } from "@/components/matches/fixture-status-badge";
import { MatchesDateStrip, dateKey, todayIn } from "@/components/matches/date-strip";
import { resolveTimeZone, startOfDayInTimeZone } from "@/lib/timezone";
import { getOrCreateProfile } from "@/lib/profile";
import { LastSyncedNote } from "@/components/football/last-synced-note";
import { getLastSyncedAt } from "@/lib/football/last-synced";
import { groupFixturesByCompetition } from "@/lib/football/group-by-competition";
import { getMatchRoomActivity } from "@/lib/football/match-room-activity";
import { RoomActivityNote } from "@/components/matches/room-activity-note";
import { getNavItem } from "@/lib/navigation";
import { staggerDelay } from "@/lib/stagger";
import { DISPLAY_LOCALE } from "@/lib/format";
import { scheduleAutoSyncIfStale } from "@/lib/football/auto-sync";

const item = getNavItem("matches");

export const metadata: Metadata = { title: item.label };

const DATE_PARAM_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Resolves the `?date=` search param to a UTC day boundary, defaulting to
 * today when the param is missing or malformed (never trusting client input
 * for the DB range query below). */
function resolveSelectedDate(dateParam: string | undefined, timeZone: string): Date {
  if (dateParam && DATE_PARAM_RE.test(dateParam)) {
    // KN-32. The `?date=` key names a calendar day, and the instant that day
    // *starts* depends on whose day it is. Parsing it as UTC midnight and then
    // querying a 24-hour window from there showed a UTC+1 viewer 23:00 the
    // night before through 22:59 of the day they asked for — off by an hour at
    // both ends, which is exactly where late kickoffs live.
    const [year, month, day] = dateParam.split("-").map(Number);
    if (year && month && day) {
      // Noon UTC on that date is inside the right calendar day in every zone on
      // earth (max offset is ±14h), so flooring it lands on the correct local
      // midnight without needing to know the offset first.
      const midday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      if (!Number.isNaN(midday.getTime())) return startOfDayInTimeZone(timeZone, midday);
    }
  }
  return todayIn(timeZone);
}

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  // Founder instruction (2026-08-18): football data arrives without anybody
  // pressing anything. This asks for a sync only if what this page is about
  // to render is already stale, and the work runs *after* the response is
  // sent — a provider outage cannot slow this page down or break it. Every
  // guard (staleness threshold, attempt cooldown, the sync lease, the quota
  // floor) lives in one place: src/lib/football/auto-sync.ts. It is not live
  // scores, and that file says so in as many words.
  scheduleAutoSyncIfStale("matches");

  const { date: dateParam } = await searchParams;
  const supabase = createServerSupabaseClient();
  const profile = await getOrCreateProfile();

  const { timeZone: viewerTimeZone } = resolveTimeZone(profile?.timezone);
  const startOfDay = resolveSelectedDate(dateParam, viewerTimeZone);
  // Next local midnight, found by stepping well past it and re-flooring, so a
  // DST transition inside the window cannot make the day 23 or 25 hours long.
  const endOfDay = startOfDayInTimeZone(viewerTimeZone, new Date(startOfDay.getTime() + 36 * 60 * 60 * 1000));
  const isToday = dateKey(startOfDay, viewerTimeZone) === dateKey(todayIn(viewerTimeZone), viewerTimeZone);

  const [{ data: fixtures }, fixturesLastSyncedAt] = await Promise.all([
    supabase
      .from("fixtures")
      .select(
        `id, kickoff_at, status, home_score, away_score,
       home_team:teams!fixtures_home_team_id_fkey(id, name, short_name, crest_url),
       away_team:teams!fixtures_away_team_id_fkey(id, name, short_name, crest_url),
       competition:competitions(id, name, short_name)`,
      )
      .gte("kickoff_at", startOfDay.toISOString())
      .lt("kickoff_at", endOfDay.toISOString())
      .order("kickoff_at", { ascending: true }),
    // RECOMMENDATIONS.md item 60: freshness readout for this whole list — every
    // fixture on it came from the same daily syncTodayFixtures() batch (entity_type
    // 'fixture'), so one timestamp covers all of them. See getLastSyncedAt().
    getLastSyncedAt(["fixture"]),
  ]);

  const dateLabel = startOfDay.toLocaleDateString(DISPLAY_LOCALE, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  // KN-41: how many people are actually talking about each of these fixtures.
  // One batched aggregate for the whole day (see getMatchRoomActivity) — a
  // fixture nobody has posted in gets no entry and renders exactly as before.
  const roomActivity = await getMatchRoomActivity(
    supabase,
    (fixtures ?? []).map((fixture) => fixture.id),
  );

  // Real match counts per competition, grouping fixtures already fetched
  // above — no new provider/DB call. See groupFixturesByCompetition.
  const competitionGroups = groupFixturesByCompetition(fixtures ?? []);
  let cardIndex = 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Matches</h1>
          <p className="text-sm text-foreground-muted">Fixtures synced from API-Football.</p>
        </div>
        <LastSyncedNote timestamp={fixturesLastSyncedAt} className="shrink-0 pt-1" />
      </FadeIn>

      <FadeIn delay={0.04}>
        <MatchesDateStrip selected={startOfDay} timeZone={viewerTimeZone} />
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
        <div className="flex flex-col gap-6">
          {competitionGroups.map((group) => (
            <div key={group.competitionId ?? group.competitionName} className="flex flex-col gap-2">
              <FadeIn delay={0.06} className="flex items-center justify-between px-1">
                {group.competitionId ? (
                  <Link
                    href={`/leagues/${group.competitionId}`}
                    className="text-sm font-semibold text-foreground transition hover:text-accent"
                  >
                    {group.competitionName}
                  </Link>
                ) : (
                  <span className="text-sm font-semibold text-foreground">{group.competitionName}</span>
                )}
                <span className="text-xs text-foreground-subtle">
                  {group.fixtures.length} {group.fixtures.length === 1 ? "fixture" : "fixtures"}
                </span>
              </FadeIn>
              <div className="flex flex-col gap-2">
                {group.fixtures.map((fixture) => {
                  const index = cardIndex++;
                  const hasScore = fixture.home_score !== null && fixture.away_score !== null;
                  return (
                    <FadeIn
                      key={fixture.id}
                      delay={0.08 + staggerDelay(index, 0.03)}
                      className="kivo-glass relative rounded-2xl p-4 transition hover:-translate-y-0.5 hover:bg-surface-2"
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
                      {/* No per-card competition label here — the group header
                          above already names it. */}
                      <div className="relative z-0 mb-2 flex items-center justify-end">
                        <FixtureStatusBadge status={fixture.status} kickoffAt={fixture.kickoff_at} />
                      </div>
                      <div className="relative z-0 flex items-center justify-between gap-3">
                        <div className="flex flex-1 items-center gap-2">
                          <TeamCrest crestUrl={fixture.home_team?.crest_url ?? null} name={fixture.home_team?.name ?? "Home"} />
                          {fixture.home_team?.id ? (
                            <Link
                              href={`/teams/${fixture.home_team.id}`}
                              className="relative z-10 truncate text-sm text-foreground hover:text-accent"
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
                              className="relative z-10 truncate text-right text-sm text-foreground hover:text-accent"
                            >
                              {fixture.away_team.name}
                            </Link>
                          ) : (
                            <span className="truncate text-right text-sm text-foreground">{fixture.away_team?.name ?? "Away team"}</span>
                          )}
                          <TeamCrest crestUrl={fixture.away_team?.crest_url ?? null} name={fixture.away_team?.name ?? "Away"} />
                        </div>
                      </div>
                      <RoomActivityNote
                        fixtureId={fixture.id}
                        activity={roomActivity.get(fixture.id)}
                        className="mt-2"
                      />
                    </FadeIn>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
