import type { Metadata } from "next";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readList } from "@/lib/query-result";
import { LoadFailed } from "@/components/ui/load-failed";
import { FadeIn } from "@/components/ui/fade-in";
import { TeamCrest } from "@/components/ui/team-crest";
import { FixtureStatusBadge } from "@/components/matches/fixture-status-badge";
import { MatchesDateStrip, dateKey, todayIn } from "@/components/matches/date-strip";
import { MatchesCompetitionFilter } from "@/components/matches/matches-competition-filter";
import { resolveTimeZone, startOfDayInTimeZone } from "@/lib/timezone";
import { getOrCreateProfile } from "@/lib/profile";
import { viewerIsSignedIn } from "@/lib/guest-preview";
import { LastSyncedNote } from "@/components/football/last-synced-note";
import { getLastSyncedAt } from "@/lib/football/last-synced";
import { groupFixturesByCompetition } from "@/lib/football/group-by-competition";
import { getCompetitionRankingSignals } from "@/lib/football/competition-ranking";
import { rankCompetitionGroups } from "@/lib/football/competition-tier";
import { isLiveStatus } from "@/lib/football/fixture-status";
import { CompetitionGroupHeader } from "@/components/matches/competition-group-header";
import { MatchesLiveToggle } from "@/components/matches/matches-live-toggle";
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
  searchParams: Promise<{ date?: string; competition?: string; live?: string }>;
}) {
  // Founder instruction (2026-08-18): football data arrives without anybody
  // pressing anything. This asks for a sync only if what this page is about
  // to render is already stale, and the work runs *after* the response is
  // sent — a provider outage cannot slow this page down or break it. Every
  // guard (staleness threshold, attempt cooldown, the sync lease, the quota
  // floor) lives in one place: src/lib/football/auto-sync.ts. It is not live
  // scores, and that file says so in as many words.
  scheduleAutoSyncIfStale("matches");

  const { date: dateParam, competition: competitionParam, live: liveParam } = await searchParams;
  const supabase = createServerSupabaseClient();
  const profile = await getOrCreateProfile();

  const { timeZone: viewerTimeZone } = resolveTimeZone(profile?.timezone);
  const startOfDay = resolveSelectedDate(dateParam, viewerTimeZone);
  // Next local midnight, found by stepping well past it and re-flooring, so a
  // DST transition inside the window cannot make the day 23 or 25 hours long.
  const endOfDay = startOfDayInTimeZone(viewerTimeZone, new Date(startOfDay.getTime() + 36 * 60 * 60 * 1000));
  const isToday = dateKey(startOfDay, viewerTimeZone) === dateKey(todayIn(viewerTimeZone), viewerTimeZone);

  const [fixturesResult, fixturesLastSyncedAt] = await Promise.all([
    supabase
      .from("fixtures")
      .select(
        `id, kickoff_at, status, home_score, away_score,
       home_team:teams!fixtures_home_team_id_fkey(id, name, short_name, crest_url),
       away_team:teams!fixtures_away_team_id_fkey(id, name, short_name, crest_url),
       competition:competitions(id, name, short_name, logo_url, country)`,
      )
      .gte("kickoff_at", startOfDay.toISOString())
      .lt("kickoff_at", endOfDay.toISOString())
      .order("kickoff_at", { ascending: true }),
    // RECOMMENDATIONS.md item 60: freshness readout for this whole list — every
    // fixture on it came from the same daily syncTodayFixtures() batch (entity_type
    // 'fixture'), so one timestamp covers all of them. See getLastSyncedAt().
    getLastSyncedAt(["fixture"]),
  ]);

  // "Nothing is scheduled on this date" is a completely ordinary answer here —
  // most dates in a synced season have no fixtures at all for a competition
  // KIVO covers — which is exactly what made the collapse dangerous on this
  // page: the empty state is so plausible that a failed read hides inside it
  // perfectly. The date strip and the header stay on screen either way, so a
  // reader can still move to another day; only the list slot changes.
  const fixturesOutcome = readList(fixturesResult, "matches.byDate");
  const fixtures = fixturesOutcome.rows;

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
    fixtures.map((fixture) => fixture.id),
  );

  // The Live toggle narrows the day to what is actually in play. Applied
  // before grouping, so the competition filter below only ever offers
  // competitions that still have something on screen once it is on.
  const liveOnly = liveParam === "1";
  const liveFixtures = fixtures.filter((fixture) => isLiveStatus(fixture.status));
  const visibleFixtures = liveOnly ? liveFixtures : fixtures;
  // Offered on today's date, and on any other date that genuinely has a
  // fixture in play (a late kickoff still running past local midnight). A
  // toggle that could only ever produce an empty list is not a choice — the
  // same rule CompetitionFilter applies to a day with one competition on it.
  const showLiveToggle = fixtures.length > 0 && (isToday || liveFixtures.length > 0);

  // Real match counts per competition, grouping fixtures already fetched
  // above — no new provider/DB call. See groupFixturesByCompetition.
  const dayGroups = groupFixturesByCompetition(visibleFixtures);

  // The filter's options are the day's own groups, so a competition is only
  // offered when narrowing to it would leave something on screen. `?competition=`
  // is validated against that list rather than trusted: an id for a competition
  // with nothing on this date resolves to no filter at all, which is the same
  // page a hand-edited URL would otherwise turn into a permanently empty one.
  // A group KIVO cannot name is not offered as a filter: a chip with no label
  // is not a choice a person can make. Its fixtures still render in the list
  // below, under a heading that is simply absent.
  const filterOptions = dayGroups
    .filter(
      (group): group is typeof group & { competitionId: string; competitionName: string } =>
        group.competitionId !== null && group.competitionName !== null,
    )
    .map((group) => ({
      id: group.competitionId,
      name: group.competitionName,
      shortName: group.fixtures[0]?.competition?.short_name ?? null,
      logoUrl: group.fixtures[0]?.competition?.logo_url ?? null,
      count: group.fixtures.length,
    }));
  // Which competition leads the page, and why.
  //
  // Kickoff order put "III Liga - Group 2" above the Champions League, because
  // the third division kicks off earlier in the day. Four real signals decide
  // it instead, in priority order: the viewer's own favourited competitions,
  // KIVO's configured coverage scope (competitions-config.ts — an operator
  // setting, not a ranking invented in the UI), how many KIVO profiles follow
  // it, then the kickoff order it already had. Every one of them is a row that
  // exists or a setting somebody made; none of them is a list of league names
  // ranked by hand. The derivation is documented in
  // src/lib/football/competition-tier.ts and the two reads it needs in
  // competition-ranking.ts. If either read fails the list simply keeps kickoff
  // order — a worse ordering, never a wrong claim.
  const rankingSignals = await getCompetitionRankingSignals(
    supabase,
    dayGroups.map((group) => group.competitionId).filter((id): id is string => id !== null),
    profile?.id ?? null,
  );
  const rankedGroups = rankCompetitionGroups(dayGroups, rankingSignals);

  const selectedCompetitionId =
    competitionParam && filterOptions.some((option) => option.id === competitionParam) ? competitionParam : null;
  const competitionGroups = selectedCompetitionId
    ? rankedGroups.filter((group) => group.competitionId === selectedCompetitionId)
    : rankedGroups;
  const selectedCompetitionName = selectedCompetitionId
    ? (filterOptions.find((option) => option.id === selectedCompetitionId)?.name ?? null)
    : null;
  // Only worth labelling the pinned block when there is something below it to
  // distinguish it from — one favourited competition and nothing else needs no
  // heading explaining why it is first.
  const favouriteGroupCount = competitionGroups.filter((group) => group.isFavourite).length;
  const showFavouriteHeadings = favouriteGroupCount > 0 && favouriteGroupCount < competitionGroups.length;
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

      <FadeIn delay={0.04} className="flex flex-col gap-3">
        <MatchesDateStrip selected={startOfDay} timeZone={viewerTimeZone} />
        {(showLiveToggle || filterOptions.length > 1) && (
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-xs text-foreground-subtle">
              {selectedCompetitionName
                ? `Showing ${selectedCompetitionName} only.`
                : liveOnly
                  ? `${visibleFixtures.length} in play.`
                  : `${filterOptions.length} ${filterOptions.length === 1 ? "competition" : "competitions"}.`}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              {showLiveToggle && (
                <MatchesLiveToggle
                  active={liveOnly}
                  liveCount={liveFixtures.length}
                  dateParam={dateParam && DATE_PARAM_RE.test(dateParam) ? dateParam : null}
                  competitionParam={selectedCompetitionId}
                />
              )}
              {filterOptions.length > 1 && (
                <MatchesCompetitionFilter
                  options={filterOptions}
                  selectedId={selectedCompetitionId}
                  totalCount={visibleFixtures.length}
                  dateParam={dateParam && DATE_PARAM_RE.test(dateParam) ? dateParam : null}
                  liveOnly={liveOnly}
                />
              )}
            </div>
          </div>
        )}
      </FadeIn>

      {fixturesOutcome.failed ? (
        <LoadFailed
          tone="section"
          title="Fixtures"
          description={`KIVO couldn't read ${isToday ? "today's" : "this date's"} fixtures just now. This is not the same as there being none — try again.`}
        />
      ) : fixtures.length === 0 ? (
        <FadeIn delay={0.08} className="kivo-glass flex flex-col items-center gap-2 rounded-2xl px-6 py-16 text-center">
          <p className="text-sm text-foreground-muted">
            No fixtures synced for {isToday ? "today" : dateLabel}.
          </p>
          <p className="max-w-xs text-xs text-foreground-subtle">
            Try another date above, or check back once KIVO&apos;s football data sync has run.
          </p>
        </FadeIn>
      ) : visibleFixtures.length === 0 ? (
        /* A third, separate fact. There ARE fixtures on this date — the reader
           just filtered them all away by asking for what is in play, and
           nothing is. Saying "no fixtures synced" here would be false, and
           saying nothing at all would look like a failure. */
        <FadeIn delay={0.08} className="kivo-glass flex flex-col items-center gap-2 rounded-2xl px-6 py-16 text-center">
          <p className="text-sm text-foreground-muted">Nothing is in play right now.</p>
          <p className="max-w-xs text-xs text-foreground-subtle">
            {fixtures.length} {fixtures.length === 1 ? "fixture is" : "fixtures are"} scheduled on this date.
          </p>
          <Link
            href={
              dateParam && DATE_PARAM_RE.test(dateParam) ? `/matches?date=${dateParam}` : "/matches"
            }
            className="kivo-focus mt-1 rounded-lg text-xs font-semibold text-accent transition hover:text-accent-strong"
          >
            Show all {fixtures.length === 1 ? "of it" : "of them"}
          </Link>
        </FadeIn>
      ) : (
        <div className="flex flex-col gap-6">
          {competitionGroups.map((group, groupIndex) => (
            <div key={group.competitionId ?? group.competitionName ?? "unnamed"} className="flex flex-col gap-2">
              {/* Says why the order is what it is, but only where a reader
                  could otherwise wonder: above the pinned block, and above the
                  first competition that is not pinned. */}
              {showFavouriteHeadings && groupIndex === 0 && <SectionLabel>Your favourites</SectionLabel>}
              {showFavouriteHeadings && groupIndex === favouriteGroupCount && (
                <SectionLabel>Other competitions</SectionLabel>
              )}
              <FadeIn delay={0.06}>
                <CompetitionGroupHeader
                  competitionId={group.competitionId}
                  competitionName={group.competitionName}
                  country={group.fixtures[0]?.competition?.country ?? null}
                  logoUrl={group.fixtures[0]?.competition?.logo_url ?? null}
                  fixtureCount={group.fixtures.length}
                  isFavourite={group.isFavourite}
                  signedIn={viewerIsSignedIn(profile)}
                />
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
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <TeamCrest crestUrl={fixture.home_team?.crest_url ?? null} name={fixture.home_team?.name ?? "Home"} />
                          {fixture.home_team?.id ? (
                            <Link
                              href={`/teams/${fixture.home_team.id}`}
                              className="relative z-10 line-clamp-2 break-words text-sm text-foreground hover:text-accent"
                            >
                              {fixture.home_team.name}
                            </Link>
                          ) : (
                            <span className="line-clamp-2 break-words text-sm text-foreground">{fixture.home_team?.name ?? "Home team"}</span>
                          )}
                        </div>
                        <span className="shrink-0 text-sm font-semibold text-foreground">
                          {hasScore ? `${fixture.home_score} – ${fixture.away_score}` : "vs"}
                        </span>
                        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                          {fixture.away_team?.id ? (
                            <Link
                              href={`/teams/${fixture.away_team.id}`}
                              className="relative z-10 line-clamp-2 break-words text-right text-sm text-foreground hover:text-accent"
                            >
                              {fixture.away_team.name}
                            </Link>
                          ) : (
                            <span className="line-clamp-2 break-words text-right text-sm text-foreground">{fixture.away_team?.name ?? "Away team"}</span>
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

/** The one-line divider above the pinned block and above the rest. Deliberately
 * quiet — it explains an ordering, it is not a heading for content. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">{children}</p>
  );
}
