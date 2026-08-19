import type { Metadata } from "next";
import Link from "next/link";
import { CalendarX } from "lucide-react";
import { DISPLAY_LOCALE } from "@/lib/format";
import { FadeIn } from "@/components/ui/fade-in";
import { HomeLeadCard } from "@/components/home/home-lead";
import { Greeting } from "@/components/home/greeting";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { HomeCompetitionSection, HomeFixtureSection } from "@/components/home/fixture-block";
import {
  BriefingCard,
  CompetitionsRail,
  FantasySection,
  FeedSection,
  FollowedPlayersSection,
  NotificationsSection,
  PredictionsSection,
  QuickActionsRail,
  TransferSection,
  TrendingRoomsSection,
} from "@/components/home/sections";
import { resolveTimeZone, startOfDayInTimeZone } from "@/lib/timezone";
import { RecentlyViewedStrip } from "@/components/home/recently-viewed-strip";
import { ProfileUnavailable } from "@/components/auth/profile-unavailable";
import { getOrCreateProfile } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readList } from "@/lib/query-result";
import { LoadFailed } from "@/components/ui/load-failed";
import { isAiConfigured } from "@/lib/ai/client";
import { getRecentNotifications } from "@/lib/notifications";
import { selectHomeLead, type LeadFixture } from "@/lib/home-lead";
import { selectHomeSections, selectQuickActions, type HomeSectionFacts } from "@/lib/home-sections";
import { buildHomeBriefing } from "@/lib/home-briefing";
import {
  loadFantasySummary,
  loadFollowedCompetitions,
  loadFollowedPlayers,
  loadPredictionSummary,
  loadTransferPulse,
  loadTrendingRooms,
} from "@/lib/home/data";
import { fetchPostsPage } from "@/app/(app)/social/posts";
import { competitionName } from "@/lib/football/competition-label";
import { PREDICTION_OUTCOME_LABEL, type PredictionOutcome } from "@/lib/predictions";
import { isLiveStatus, type FixtureStatus } from "@/lib/football/fixture-status";
import { fetchFixturesForTeams } from "@/lib/football/fixtures-by-team";
import { scheduleAutoSyncIfStale } from "@/lib/football/auto-sync";

export const metadata: Metadata = { title: "Home" };

/**
 * /home — the screen that decides whether somebody opens KIVO tomorrow.
 *
 * ## What this page is
 *
 * Not a dashboard. A dashboard renders the same tiles in the same order for
 * everybody and leaves the reader to find the point. This page computes its
 * own order from what is actually true for this reader right now, and the two
 * questions it is built to answer correctly are:
 *
 *   **3pm on a Saturday** — a followed club in play leads; the rest of the
 *   live card follows it; then the rest of today's football. Fantasy, results
 *   and browsing all fall below the fold, because none of it is happening.
 *
 *   **Tuesday morning** — nothing is live, so the live sections do not exist
 *   at all, and the page opens on last night's result, then what happened
 *   while they were away, then the next kickoff.
 *
 * Same rules, genuinely different pages. The ranking itself lives in two pure,
 * unit-tested modules — `src/lib/home-lead.ts` picks the single lead and
 * `src/lib/home-sections.ts` ranks everything below it — and this file's job
 * is narrow and should stay that way: fetch real rows, hand them to the two
 * ladders, and render whatever comes back in the order it comes back in. No
 * section decides its own position and **no section renders an empty state** —
 * a section with nothing in it is simply not in the list.
 *
 * ## Why there is no tab rail on this page
 *
 * `SectionTabs` landed while this was being built and Home is the obvious
 * place to reach for it. It is the wrong place. A tab bar is right when a
 * screen holds genuinely separate destinations; here it would put live
 * football one tap behind "For you", and a fan who opens the app at 3pm on a
 * Saturday to a screen that does not show them the football has been failed by
 * the navigation, however tidy it looks. The ladder is this page's structure.
 * The rail belongs on Match Centre, Team, Player and Competition, where the
 * sections really are alternatives to each other.
 */

/** Today's fixtures for followed clubs. Explicit ceiling — a follow set is
 * user-controlled and a matchday can be large. */
const MATCHDAY_FIXTURES_LIMIT = 20;
const UPCOMING_FIXTURES_LIMIT = 6;
/** Recent results for followed clubs. Six is two rounds for most readers. */
const RECENT_RESULTS_LIMIT = 6;
/** How far back a finished fixture is still worth showing. Beyond a week it is
 * history, and history belongs on the club's own page. */
const RESULTS_WINDOW_DAYS = 7;
/** Today's fixtures across KIVO. Wider than the handful that get listed,
 * because the Room-activity pass needs a real field to find the busiest
 * conversation in — asking three fixtures which is busiest is not a ranking. */
const TODAY_FIXTURES_SCAN_LIMIT = 24;
const TODAY_FIXTURES_SHOWN = 8;
/** Matches in play across KIVO. A full Saturday afternoon slate fits. */
const LIVE_FIXTURES_LIMIT = 12;
const TRENDING_ROOMS_SHOWN = 3;
const FOLLOWED_PLAYERS_SHOWN = 4;
const FOLLOWED_COMPETITIONS_SHOWN = 8;
const TRANSFER_PULSE_SHOWN = 3;
const NOTIFICATIONS_SHOWN = 3;
const FEED_POSTS_SHOWN = 3;

/** The shape every fixture query on this page selects. */
type FixtureRowShape = {
  id: string;
  kickoff_at: string;
  status: FixtureStatus;
  minute_elapsed: number | null;
  home_score: number | null;
  away_score: number | null;
  home_team_id: string;
  away_team_id: string;
  home_team: { name: string; crest_url: string | null } | null;
  away_team: { name: string; crest_url: string | null } | null;
  competition: { id: string; name: string; short_name: string | null; logo_url: string | null } | null;
};

/**
 * `minute_elapsed` and the competition join are new here.
 *
 * Without the minute, a live match on the first screen of the app said "Live"
 * where every other surface in KIVO says "67'" — the shared match row already
 * knew how to draw it and Home simply never fetched it. Without the
 * competition, a fixture list on Home could not be grouped the way /matches
 * and /live group theirs, which is the way a card of football is read.
 */
const FIXTURE_SELECT = `id, kickoff_at, status, minute_elapsed, home_score, away_score, home_team_id, away_team_id,
   home_team:teams!fixtures_home_team_id_fkey(name, crest_url),
   away_team:teams!fixtures_away_team_id_fkey(name, crest_url),
   competition:competitions(id, name, short_name, logo_url)`;

function toLeadFixture(row: FixtureRowShape, teamNames: Map<string, string>): LeadFixture {
  // "Because you follow X" has to name the club the *viewer* follows, not
  // whichever side happens to be listed first — so the name is looked up from
  // their own follow set, and left null (reason falls back) if neither side is
  // in it.
  const followedName = teamNames.get(row.home_team_id) ?? teamNames.get(row.away_team_id) ?? null;
  return {
    id: row.id,
    kickoffAt: row.kickoff_at,
    status: row.status,
    competitionName: competitionName(row.competition),
    minuteElapsed: row.minute_elapsed,
    homeName: row.home_team?.name ?? "Home",
    homeCrestUrl: row.home_team?.crest_url ?? null,
    awayName: row.away_team?.name ?? "Away",
    awayCrestUrl: row.away_team?.crest_url ?? null,
    homeScore: row.home_score,
    awayScore: row.away_score,
    followedTeamName: followedName,
  };
}

export default async function HomePage() {
  // Football data arrives without anybody pressing anything. This asks for a
  // refresh only if what this page is about to render is already stale, and
  // the work runs *after* the response is sent — a provider outage cannot slow
  // this page down or break it. Every guard lives in one place:
  // src/lib/football/auto-sync.ts.
  scheduleAutoSyncIfStale("matches");

  const profile = await getOrCreateProfile();

  // The greeting's hour comes from the timezone the user actually stated
  // (profiles.timezone). When they haven't stated one this stays null and
  // <Greeting> reads the browser's own clock after mount — the only honest
  // source available, and one that must never be guessed at during SSR.
  const statedTimeZone = resolveTimeZone(profile?.timezone);
  const statedGreetingHour = statedTimeZone.isStated
    ? Number(
        new Intl.DateTimeFormat("en-GB", { timeZone: statedTimeZone.timeZone, hour: "2-digit", hourCycle: "h23" }).format(
          new Date(),
        ),
      )
    : null;

  // The (app) layout already guarantees a signed-in viewer with a real
  // profile row, so a null here is not a guest — it is a transient read
  // failure between that check and this one.
  if (!profile) return <ProfileUnavailable />;

  const firstName = profile.display_name?.split(" ")[0] || profile.username || "there";
  const aiConfigured = isAiConfigured();

  const supabase = createServerSupabaseClient();

  // One clock for the whole render: the lead ladder, the section ladder, the
  // "today" window and the "upcoming" cutoff all have to agree, or a fixture
  // can be simultaneously "on today" and "in the past".
  const nowDate = new Date();
  const now = nowDate.getTime();
  // The viewer's day, not the server's — `startOfDayInTimeZone` is DST-correct
  // and `resolveTimeZone` falls back to UTC (and says it is a fallback) for a
  // user who has not stated a zone.
  const viewerTimeZone = statedTimeZone.timeZone;
  const startOfDay = startOfDayInTimeZone(viewerTimeZone, nowDate);
  const endOfDay = startOfDayInTimeZone(viewerTimeZone, new Date(startOfDay.getTime() + 36 * 60 * 60 * 1000));
  const resultsFrom = new Date(now - RESULTS_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // The follow graph is what makes this page personal at all. Two-step because
  // `followed_id` has no DB-level FK (it's polymorphic across
  // team/player/competition), so the ids have to be resolved before anything
  // can be filtered on them.
  //
  // This one read decides who the viewer *is* on this page. Every section
  // below is scoped by it, so a failure here does not produce an empty home —
  // it produces a confident, fully-rendered home belonging to somebody who
  // follows nothing. That is not a missing section, it is the wrong person,
  // and it is why this read is treated as load-bearing while most others on
  // this page are not.
  const followsOutcome = readList(
    await supabase
      .from("follows")
      .select("followed_id, followed_type")
      .eq("follower_profile_id", profile.id)
      .in("followed_type", ["team", "player", "competition"]),
    "home.follows",
  );

  const followRows = followsOutcome.rows;
  const followedTeamIds = followRows.filter((f) => f.followed_type === "team").map((f) => f.followed_id);
  const followedPlayerIds = followRows.filter((f) => f.followed_type === "player").map((f) => f.followed_id);
  const favouriteCompetitionIds = new Set(
    followRows.filter((f) => f.followed_type === "competition").map((f) => f.followed_id),
  );

  // A favourite club picked at onboarding counts as "yours" here even if the
  // user never pressed Follow on it — it is the one personalisation signal
  // every completed onboarding produces.
  const matchdayTeamIds = [
    ...new Set([...followedTeamIds, ...(profile.favourite_team_id ? [profile.favourite_team_id] : [])]),
  ];

  const [
    todayFixturesResult,
    liveFixturesResult,
    { data: xpTotal },
    { data: fantasyTeams },
    { data: myTeamRows },
    followedPlayers,
    followedCompetitions,
    transferPulse,
    predictionSummary,
    { notifications, unreadCount },
    feed,
    matchdayOutcome,
    upcomingOutcome,
    resultsOutcome,
  ] = await Promise.all([
    supabase
      .from("fixtures")
      .select(FIXTURE_SELECT)
      .gte("kickoff_at", startOfDay.toISOString())
      .lt("kickoff_at", endOfDay.toISOString())
      .order("kickoff_at", { ascending: true })
      .limit(TODAY_FIXTURES_SCAN_LIMIT),
    // Everything in play across KIVO, independent of the viewer's own clubs
    // and independent of the day window — a late kickoff still in progress
    // after midnight is live football and belongs on a live list.
    supabase
      .from("fixtures")
      .select(FIXTURE_SELECT)
      .in("status", ["live", "halftime"])
      .order("kickoff_at", { ascending: true })
      .limit(LIVE_FIXTURES_LIMIT),
    // Single aggregate round trip instead of fetching every xp_ledger row and
    // summing in JS — see get_xp_total in migration 0023.
    supabase.rpc("get_xp_total", { p_profile_id: profile.id }),
    // Fetched as rows rather than a count because the lead ladder needs the
    // league's season to find this viewer's next gameweek deadline.
    supabase
      .from("fantasy_teams")
      .select("id, league:fantasy_leagues!inner(season_id)")
      .eq("owner_profile_id", profile.id),
    matchdayTeamIds.length
      ? supabase.from("teams").select("id, name, short_name").in("id", matchdayTeamIds)
      : Promise.resolve({ data: null }),
    loadFollowedPlayers(supabase, profile.id, FOLLOWED_PLAYERS_SHOWN),
    loadFollowedCompetitions(supabase, profile.id, startOfDay, endOfDay, FOLLOWED_COMPETITIONS_SHOWN),
    loadTransferPulse(supabase, matchdayTeamIds, followedPlayerIds, TRANSFER_PULSE_SHOWN),
    loadPredictionSummary(supabase, profile.id),
    getRecentNotifications(),
    // The personalised half of the feed: posts by accounts this viewer chose
    // to follow. Same fetcher /social uses, so a post cannot look one way here
    // and another way there.
    fetchPostsPage(0, profile.id, { followingOnly: true, limit: FEED_POSTS_SHOWN }),
    // These three chunk the follow set and merge sorted prefixes rather than
    // building one `.or()` filter that grows with the follow count — see
    // src/lib/football/fixtures-by-team.ts for why that matters and why the
    // merge is exact rather than a heuristic.
    fetchFixturesForTeams(matchdayTeamIds, MATCHDAY_FIXTURES_LIMIT, (column, ids) =>
      supabase
        .from("fixtures")
        .select(FIXTURE_SELECT)
        .gte("kickoff_at", startOfDay.toISOString())
        .lt("kickoff_at", endOfDay.toISOString())
        .in(column, ids)
        .order("kickoff_at", { ascending: true })
        .limit(MATCHDAY_FIXTURES_LIMIT),
    ),
    fetchFixturesForTeams(matchdayTeamIds, UPCOMING_FIXTURES_LIMIT, (column, ids) =>
      supabase
        .from("fixtures")
        .select(FIXTURE_SELECT)
        .in(column, ids)
        .eq("status", "scheduled")
        .gt("kickoff_at", nowDate.toISOString())
        .order("kickoff_at", { ascending: true })
        .limit(UPCOMING_FIXTURES_LIMIT),
    ),
    // "How did we get on?" — the question the previous build had no answer to
    // at all. It showed fixtures ahead and never a result behind, which is
    // most of why the page had nothing to say on a Tuesday morning.
    fetchFixturesForTeams(
      matchdayTeamIds,
      RECENT_RESULTS_LIMIT,
      (column, ids) =>
        supabase
          .from("fixtures")
          .select(FIXTURE_SELECT)
          .in(column, ids)
          .eq("status", "finished")
          .gte("kickoff_at", resultsFrom.toISOString())
          .lt("kickoff_at", nowDate.toISOString())
          .order("kickoff_at", { ascending: false })
          .limit(RECENT_RESULTS_LIMIT),
      "desc",
    ),
  ]);

  // "No football today" is a real and common answer; "KIVO couldn't read the
  // fixture list" is not the same sentence and must not borrow its words.
  const todayFixturesOutcome = readList(todayFixturesResult, "home.todayFixtures");
  const liveOutcome = readList(liveFixturesResult, "home.liveFixtures");
  const todayFixtures = todayFixturesOutcome.rows as unknown as FixtureRowShape[];

  const totalXp = xpTotal ?? 0;
  const teamNames = new Map<string, string>(
    (myTeamRows ?? []).map((t) => [t.id, t.short_name || t.name] as const),
  );

  const matchdayFixtures = matchdayOutcome.rows;
  const upcomingFixtures = upcomingOutcome.rows;
  const recentResults = resultsOutcome.rows;

  // The gate. Four reads, and each is one the page cannot be honest without:
  // who the viewer follows, what is on today, and their own clubs' fixtures in
  // both directions. If any failed, /home would still render a greeting, a
  // lead slot and section headings — every one of them making a claim about
  // this person's football that KIVO cannot currently support.
  //
  // Everything *not* in this list is deliberately left tolerant: XP, fantasy,
  // transfers, notifications, the feed and the prediction summary each own one
  // section, and one absent section should not take down a home page that
  // otherwise works. That asymmetry is the judgement, not an oversight.
  if (
    followsOutcome.failed ||
    todayFixturesOutcome.failed ||
    matchdayOutcome.failed ||
    upcomingOutcome.failed
  ) {
    return (
      <LoadFailed
        title="Your home"
        description="KIVO couldn't read your clubs and today's fixtures just now, so this page would be guessing about your football rather than reporting it. Nothing has been lost — try again."
      />
    );
  }

  // ── The lead slot ────────────────────────────────────────────────────────
  // Everything below is *facts*; the ranking lives in src/lib/home-lead.ts.
  const liveRow = matchdayFixtures.find((f) => isLiveStatus(f.status)) ?? null;
  const nextRow = upcomingFixtures[0] ?? null;

  // The viewer's own call on the fixture about to lead the page — one targeted
  // lookup rather than fetching every prediction they have ever made.
  const { data: leadPrediction } = nextRow
    ? await supabase
        .from("predictions")
        .select("predicted_outcome")
        .eq("profile_id", profile.id)
        .eq("fixture_id", nextRow.id)
        .maybeSingle()
    : { data: null };

  // Next fantasy deadline for a season this viewer actually has a team in.
  // Skipped entirely for a non-player, so the ladder can never nag somebody
  // about a game they haven't joined.
  const fantasySeasonIds = [...new Set((fantasyTeams ?? []).map((t) => t.league?.season_id).filter(Boolean))] as string[];
  const { data: nextGameweek } = fantasySeasonIds.length
    ? await supabase
        .from("fantasy_gameweeks")
        .select("id, number, deadline_at")
        .in("season_id", fantasySeasonIds)
        .gt("deadline_at", nowDate.toISOString())
        .order("deadline_at", { ascending: true })
        .limit(1)
        .maybeSingle()
    : { data: null };

  const { count: confirmedRosterCount } = nextGameweek && fantasyTeams?.length
    ? await supabase
        .from("fantasy_rosters")
        .select("id", { count: "exact", head: true })
        .eq("gameweek_id", nextGameweek.id)
        .in(
          "fantasy_team_id",
          fantasyTeams.map((t) => t.id),
        )
    : { count: null };

  const rosterConfirmed = (confirmedRosterCount ?? 0) > 0;

  const lead = selectHomeLead({
    now,
    followedTeamCount: matchdayTeamIds.length,
    liveFixture: liveRow ? toLeadFixture(liveRow, teamNames) : null,
    nextFixture: nextRow ? toLeadFixture(nextRow, teamNames) : null,
    nextFixturePrediction: leadPrediction
      ? PREDICTION_OUTCOME_LABEL[leadPrediction.predicted_outcome as PredictionOutcome]
      : null,
    openPredictionCount: predictionSummary?.openCount ?? 0,
    fantasy: nextGameweek
      ? { gameweekNumber: nextGameweek.number, deadlineAt: nextGameweek.deadline_at, rosterConfirmed }
      : null,
  });

  // Whatever the lead is already showing is removed from the lists below it —
  // a page whose headline and its own supporting list repeat the same fixture
  // reads as a bug, not as emphasis.
  const leadFixtureId = "fixture" in lead ? lead.fixture.id : null;
  const matchdayRest = matchdayFixtures.filter((f) => f.id !== leadFixtureId);
  const upcomingRest = upcomingFixtures.filter((f) => f.id !== leadFixtureId).slice(0, 5);

  // Everything the viewer's own sections already show comes out of the two
  // KIVO-wide lists — "the rest of today's football" has to actually be the
  // rest of it, and a match cannot be both "yours" and "elsewhere".
  const ownFixtureIds = new Set<string>([
    ...(leadFixtureId ? [leadFixtureId] : []),
    ...matchdayRest.map((f) => f.id),
  ]);
  const liveElsewhere = (liveOutcome.rows as unknown as FixtureRowShape[]).filter((f) => !ownFixtureIds.has(f.id));
  const liveElsewhereIds = new Set(liveElsewhere.map((f) => f.id));
  const topMatches = todayFixtures
    .filter((f) => !ownFixtureIds.has(f.id) && !liveElsewhereIds.has(f.id))
    .slice(0, TODAY_FIXTURES_SHOWN);

  const followedTeamIdSet = new Set(matchdayTeamIds);
  const [trendingRooms, fantasySummary] = await Promise.all([
    loadTrendingRooms(supabase, todayFixtures, followedTeamIdSet, TRENDING_ROOMS_SHOWN),
    loadFantasySummary(
      supabase,
      (fantasyTeams ?? []).map((t) => t.id),
    ),
  ]);

  const feedPosts = feed.posts;

  // ── The section ladder ───────────────────────────────────────────────────
  const facts: HomeSectionFacts = {
    now,
    lead,
    briefingLineCount: 0, // replaced below, once the briefing is composed
    unreadNotificationCount: unreadCount,
    clubsTodayCount: matchdayRest.length,
    hasLiveFollowedFixture: Boolean(liveRow) || matchdayRest.some((f) => isLiveStatus(f.status)),
    liveElsewhereCount: liveElsewhere.length,
    recentResults: { count: recentResults.length, latestAt: recentResults[0]?.kickoff_at ?? null },
    fantasy: fantasySummary
      ? {
          deadlineAt: nextGameweek?.deadline_at ?? null,
          rosterConfirmed,
          latestPoints: fantasySummary.latestPoints,
          rank: fantasySummary.rank,
        }
      : null,
    predictions: predictionSummary
      ? {
          openCount: predictionSummary.openCount,
          nextLockAt: predictionSummary.nextLockAt,
          currentStreak: predictionSummary.currentStreak,
        }
      : null,
    trendingRoom: trendingRooms[0]
      ? {
          participantCount: trendingRooms[0].participantCount,
          involvesFollowedClub: trendingRooms.some((room) => room.involvesFollowedClub),
        }
      : null,
    feedPostCount: feedPosts.length,
    transferPulse: {
      count: transferPulse.length,
      latestAt: transferPulse[0]?.transferDate ?? null,
    },
    followedPlayerCount: followedPlayers.length,
    followedCompetitionCount: followedCompetitions.length,
    topMatchCount: topMatches.length,
    upcomingCount: upcomingRest.length,
    aiConfigured,
  };

  const briefingLines = buildHomeBriefing({
    now,
    clubsToday: {
      count: matchdayFixtures.length,
      liveCount: matchdayFixtures.filter((f) => isLiveStatus(f.status)).length,
      nextKickoffAt: matchdayFixtures.find((f) => new Date(f.kickoff_at).getTime() > now)?.kickoff_at ?? null,
      firstFixtureId: matchdayFixtures[0]?.id ?? null,
    },
    fantasy:
      fantasySummary && nextGameweek
        ? {
            gameweekNumber: nextGameweek.number,
            deadlineAt: nextGameweek.deadline_at,
            rosterConfirmed,
            latestPoints: fantasySummary.latestPoints,
          }
        : fantasySummary
          ? {
              // No upcoming gameweek: the only line this can produce is the
              // "you scored N last week" one, which never reads a number.
              gameweekNumber: null,
              deadlineAt: null,
              rosterConfirmed,
              latestPoints: fantasySummary.latestPoints,
            }
          : null,
    predictions: predictionSummary
      ? { openCount: predictionSummary.openCount, currentStreak: predictionSummary.currentStreak }
      : null,
    latestTransfer: transferPulse[0]
      ? {
          playerName: transferPulse[0].playerName,
          toTeamName: transferPulse[0].toTeamName,
          dateLabel: transferPulse[0].dateLabel,
        }
      : null,
    trendingRoom: trendingRooms[0]
      ? {
          label: `${trendingRooms[0].participantCount} people are talking about ${trendingRooms[0].homeName} v ${trendingRooms[0].awayName}.`,
          fixtureId: trendingRooms[0].fixtureId,
        }
      : null,
    unreadNotificationCount: unreadCount,
  });

  facts.briefingLineCount = briefingLines.length;

  const sections = selectHomeSections(facts);
  const quickActions = selectQuickActions(facts);

  /**
   * A description is a *fact* the heading does not already carry. Most sections
   * pass null: "Transfers" needs no caption explaining that it lists transfers,
   * and eight captions stacked is what made this page read as generated.
   */
  function clubsDescription(): string | null {
    const names = [...new Set([...matchdayRest].flatMap((f) => [
      teamNames.get(f.home_team_id),
      teamNames.get(f.away_team_id),
    ]))].filter((name): name is string => Boolean(name));
    if (names.length === 0) return null;
    if (names.length <= 2) return names.join(" and ");
    return `${names[0]} and ${names.length - 1} others`;
  }

  // One switch, rendered in the order the ladder returned. Adding a section
  // means adding a case here and a rule there — never reordering this file.
  function renderSection(id: (typeof sections)[number]["id"], reason: string) {
    switch (id) {
      case "briefing":
        return <BriefingCard lines={briefingLines} aiConfigured={aiConfigured} />;

      case "notifications":
        return (
          <NotificationsSection
            notifications={notifications.slice(0, NOTIFICATIONS_SHOWN)}
            description={unreadCount > NOTIFICATIONS_SHOWN ? `${unreadCount} unread` : null}
          />
        );

      case "clubs_today":
        return (
          <HomeFixtureSection
            title="Your clubs today"
            description={clubsDescription()}
            action={{ href: "/matches", label: "Matches" }}
            fixtures={matchdayRest}
          />
        );

      case "live_now":
        return (
          <HomeCompetitionSection
            title="Live now"
            action={{ href: "/live", label: "All live" }}
            fixtures={liveElsewhere}
            favouriteCompetitionIds={favouriteCompetitionIds}
          />
        );

      case "results":
        return (
          <HomeFixtureSection
            title="Results"
            action={{ href: "/matches", label: "Matches" }}
            fixtures={recentResults}
          />
        );

      case "fantasy":
        return fantasySummary ? (
          <FantasySection
            summary={fantasySummary}
            deadlineAt={nextGameweek?.deadline_at ?? null}
            rosterConfirmed={rosterConfirmed}
            gameweekNumber={nextGameweek?.number ?? null}
            now={now}
          />
        ) : null;

      case "predictions":
        return predictionSummary ? (
          <PredictionsSection summary={predictionSummary} now={now} />
        ) : null;

      case "trending_rooms":
        return <TrendingRoomsSection rooms={trendingRooms} />;

      case "feed":
        return <FeedSection posts={feedPosts} />;

      case "transfer_pulse":
        return <TransferSection transfers={transferPulse} />;

      case "your_players":
        return <FollowedPlayersSection players={followedPlayers} />;

      case "your_competitions":
        return <CompetitionsRail competitions={followedCompetitions} />;

      case "top_matches":
        return (
          <HomeCompetitionSection
            title="Today's football"
            action={{ href: "/matches", label: "All matches" }}
            fixtures={topMatches}
            favouriteCompetitionIds={favouriteCompetitionIds}
          />
        );

      case "no_football_yet":
        // With the app gated, this is the first thing a brand-new account
        // reads on a day KIVO has no card at all. Same fact a fan would tell
        // another fan — never an explanation of what KIVO failed to do.
        //
        // The invitation lives in the lead slot, so when the lead is *already*
        // "follow a club" this carries no action: two copies of "Find your
        // club" on one short screen reads as filler rather than as help.
        return (
          <Section title="Today's football">
            <EmptyState
              tone="section"
              icon={CalendarX}
              title="Nothing on today's card yet"
              description="The moment today's fixtures are in, they land here first."
              action={
                lead.kind === "follow_a_club" ? undefined : (
                  <Link
                    href="/teams"
                    className="kivo-focus inline-flex min-h-11 items-center rounded-xl border border-hairline bg-surface-1 px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
                  >
                    Find your club
                  </Link>
                )
              }
            />
          </Section>
        );

      case "upcoming":
        return (
          <HomeFixtureSection
            title="Next up"
            action={{ href: "/profile/following", label: "Manage" }}
            fixtures={upcomingRest}
          />
        );

      case "recently_viewed":
        // Renders nothing at all when localStorage is empty — the one section
        // whose contents the server genuinely cannot see.
        return <RecentlyViewedStrip />;
    }
    // `reason` is deliberately unused by most cases: the ladder computes it so
    // the ordering stays readable and testable, and the page prints it only
    // where it states something the heading does not.
    void reason;
    return null;
  }

  return (
    <div className="kivo-page">
      <FadeIn className="flex flex-col gap-0.5">
        <Greeting statedHour={statedGreetingHour} />
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {firstName}, here&apos;s your football.
        </h1>
      </FadeIn>

      <FadeIn delay={0.06}>
        <HomeLeadCard lead={lead} />
      </FadeIn>

      <FadeIn delay={0.09} className="flex flex-col gap-2">
        <QuickActionsRail actions={quickActions} />
        {/* XP is only shown once there is some. A "0 XP" line on a first
            session is exactly the kind of true-but-useless zero this page is
            not allowed to render. */}
        {totalXp > 0 && (
          <Link
            href="/rewards"
            className="kivo-focus self-start px-1 py-1 text-xs font-medium text-foreground-subtle hover:text-foreground-muted"
          >
            {totalXp.toLocaleString(DISPLAY_LOCALE)} XP earned · see your badges
          </Link>
        )}
      </FadeIn>

      {sections.map((section, index) => (
        <FadeIn key={section.id} delay={0.12 + index * 0.03}>
          {renderSection(section.id, section.reason)}
        </FadeIn>
      ))}
    </div>
  );
}
