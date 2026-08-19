import type { Metadata } from "next";
import Link from "next/link";
import { Flame, Star, Users, ArrowRight } from "lucide-react";
import { DISPLAY_LOCALE } from "@/lib/format";
import { FadeIn } from "@/components/ui/fade-in";
import { MatchList, MatchListRow } from "@/components/matches/match-list";
import { HomeLeadCard } from "@/components/home/home-lead";
import { Greeting } from "@/components/home/greeting";
import { HomeSectionCard } from "@/components/home/section-card";
import {
  BriefingCard,
  FantasyCard,
  FollowedPlayersCard,
  NotificationsCard,
  PredictionsCard,
  QuickActionsRow,
  TransferPulseCard,
  TrendingRoomsCard,
} from "@/components/home/sections";
import { resolveTimeZone, startOfDayInTimeZone } from "@/lib/timezone";
import { AiTeaser } from "@/components/home/ai-teaser";
import { RecentlyViewedStrip } from "@/components/home/recently-viewed-strip";
import { TeamCrest } from "@/components/ui/team-crest";
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
  loadFollowedPlayers,
  loadPredictionSummary,
  loadTransferPulse,
  loadTrendingRooms,
} from "@/lib/home/data";
import { PREDICTION_OUTCOME_LABEL, type PredictionOutcome } from "@/lib/predictions";
import { isLiveStatus, type FixtureStatus } from "@/lib/football/fixture-status";
import { fetchFixturesForTeams } from "@/lib/football/fixtures-by-team";
import { scheduleAutoSyncIfStale } from "@/lib/football/auto-sync";

export const metadata: Metadata = { title: "Home" };

/**
 * /home — the personal football command centre.
 *
 * The founding directive names thirteen things this page should carry. What
 * makes it a command centre rather than a dashboard is not the count, it is
 * that **the order is computed per reader**: `home-lead.ts` picks the single
 * lead, and `home-sections.ts` ranks everything below it from the same facts,
 * with each section carrying the reason it is where it is. Two people with
 * different clubs, different fantasy states and different unread counts get
 * genuinely different pages, and both can read why.
 *
 * This file's job is therefore narrow and should stay that way: fetch real
 * rows, hand them to the two pure ranking modules, and render whatever comes
 * back in the order it comes back in. No section decides its own position and
 * no section renders an empty state — a section with nothing in it is simply
 * not in the list.
 */

/**
 * KIVO_NEXT_GEN KN-16: neither followed-team fixture query had a `LIMIT`. The
 * "today" one renders a section headed by whatever is live, and the "upcoming"
 * one already asked for 6 — these make both ceilings explicit rather than
 * relying on a followed-team set staying small.
 */
const MATCHDAY_FIXTURES_LIMIT = 20;
const UPCOMING_FIXTURES_LIMIT = 6;
/** Today's fixtures across KIVO. Wider than the three that get listed,
 * because the Room-activity pass needs a real field to find the busiest
 * conversation in — asking three fixtures which is busiest is not a ranking. */
const TODAY_FIXTURES_SCAN_LIMIT = 24;
const TODAY_FIXTURES_SHOWN = 3;
const TRENDING_ROOMS_SHOWN = 3;
const FOLLOWED_PLAYERS_SHOWN = 4;
const TRANSFER_PULSE_SHOWN = 3;
const NOTIFICATIONS_SHOWN = 3;

/** The shape every fixture query on this page selects, so the row → LeadFixture
 * conversion below can be written once. */
type FixtureRowShape = {
  id: string;
  kickoff_at: string;
  status: FixtureStatus;
  home_score: number | null;
  away_score: number | null;
  home_team_id: string;
  away_team_id: string;
  home_team: { name: string; crest_url: string | null } | null;
  away_team: { name: string; crest_url: string | null } | null;
};

const FIXTURE_SELECT = `id, kickoff_at, status, home_score, away_score, home_team_id, away_team_id,
   home_team:teams!fixtures_home_team_id_fkey(name, crest_url),
   away_team:teams!fixtures_away_team_id_fkey(name, crest_url)`;

function toLeadFixture(row: FixtureRowShape, teamNames: Map<string, string>): LeadFixture {
  // "Because you follow X" has to name the club the *viewer* follows, not
  // whichever side happens to be listed first — so the name is looked up from
  // their own follow set, and left null (reason falls back) if neither side is
  // in it, which happens for a favourite-team-only fixture whose team row
  // didn't come back.
  const followedName = teamNames.get(row.home_team_id) ?? teamNames.get(row.away_team_id) ?? null;
  return {
    id: row.id,
    kickoffAt: row.kickoff_at,
    status: row.status,
    homeName: row.home_team?.name ?? "Home",
    homeCrestUrl: row.home_team?.crest_url ?? null,
    awayName: row.away_team?.name ?? "Away",
    awayCrestUrl: row.away_team?.crest_url ?? null,
    homeScore: row.home_score,
    awayScore: row.away_score,
    followedTeamName: followedName,
  };
}

/**
 * Home's fixture lists.
 *
 * FRONTEND SWEEP: these were a third distinct match row — home and away side by
 * side with the score squeezed between them, no time rail, its own hover and
 * entrance animation. Home is the first screen anyone opens, so the app's first
 * impression was a match row that appears nowhere else in it.
 *
 * They are now the same rows /matches and /live render, `inset` because the
 * section card around them already provides the surface. `dateLabels` used to
 * substitute a date into the score slot for the "Your teams" list, which is what
 * a fixture list on Home is really showing; `MatchListRow`'s rail carries that
 * job properly, since a fixture with no score already shows its kickoff there.
 */
function FixtureList({ fixtures }: { fixtures: FixtureRowShape[] }) {
  return (
    <MatchList inset>
      {fixtures.map((fixture) => (
        <MatchListRow key={fixture.id} fixture={fixture} />
      ))}
    </MatchList>
  );
}

export default async function HomePage() {
  // Founder instruction (2026-08-18): football data arrives without anybody
  // pressing anything. This asks for a sync only if what this page is about
  // to render is already stale, and the work runs *after* the response is
  // sent — a provider outage cannot slow this page down or break it. Every
  // guard (staleness threshold, attempt cooldown, the sync lease, the quota
  // floor) lives in one place: src/lib/football/auto-sync.ts. It is not live
  // scores, and that file says so in as many words.
  scheduleAutoSyncIfStale("matches");

  // Routed through KIVO's own profile rather than reading the auth user
  // directly — consistent with the rest of the app, and never throws if
  // Supabase isn't configured for this environment (see lib/profile.ts).
  const profile = await getOrCreateProfile();

  // KN-33. The greeting used to be `new Date().getHours()` in a Server
  // Component, which on Vercel is UTC — a fan opening KIVO in Lagos at 08:00
  // was told "Good evening" on the first line of the first screen after
  // sign-in. When the user has told us their timezone (profiles.timezone,
  // migration 0054) the correct hour is computable here, server-side, with no
  // hydration flash and no dependence on the device clock. When they haven't,
  // this stays null and <Greeting> reads the browser's own clock after mount —
  // which is the only honest source available, and must never be guessed at
  // during SSR.
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
  // failure between that check and this one. Saying so is honest; the old
  // code's "Sign up to follow a team" branch told a signed-in user they were
  // signed out (KN-39).
  if (!profile) return <ProfileUnavailable />;

  const firstName = profile.display_name?.split(" ")[0] || profile.username || "there";
  const aiConfigured = isAiConfigured();

  const supabase = createServerSupabaseClient();

  // One clock for the whole render: the lead ladder, the section ladder, the
  // "today" window and the "upcoming" cutoff all have to agree, or a fixture
  // can be simultaneously "on today" and "in the past".
  const nowDate = new Date();
  const now = nowDate.getTime();
  // KN-32: the viewer's day, not the server's. `setUTCHours(0,0,0,0)` meant a
  // 00:30 WAT kickoff — routine in the stated launch market, which is UTC+1 —
  // fell on the previous UTC day and simply vanished from "today's matches" for
  // the people it was closest to. `startOfDayInTimeZone` is DST-correct;
  // `resolveTimeZone` falls back to UTC (and says it is a fallback) for a user
  // who has not stated a zone, so nothing regresses for them.
  const viewerTimeZone = statedTimeZone.timeZone;
  const startOfDay = startOfDayInTimeZone(viewerTimeZone, nowDate);
  const endOfDay = startOfDayInTimeZone(viewerTimeZone, new Date(startOfDay.getTime() + 36 * 60 * 60 * 1000));

  // "Your teams" and "your players" — the follow graph is what makes this page
  // personal at all (RECOMMENDATIONS item 13). Two-step because `followed_id`
  // has no DB-level FK (it's polymorphic across team/player/competition), so
  // the ids have to be resolved before anything can be filtered on them.
  // This one read decides who the viewer *is* on this page. Every section
  // below is scoped by it, so `data ?? []` here does not produce an empty
  // home — it produces a confident, fully-rendered home belonging to somebody
  // who follows nothing. That is not a missing section, it is the wrong
  // person, and it is the reason this read is treated as load-bearing while
  // most of the others on this page are not.
  const followsOutcome = readList(
    await supabase
      .from("follows")
      .select("followed_id, followed_type")
      .eq("follower_profile_id", profile.id)
      .in("followed_type", ["team", "player"]),
    "home.follows",
  );

  const followRows = followsOutcome.rows;
  const followedTeamIds = followRows.filter((f) => f.followed_type === "team").map((f) => f.followed_id);
  const followedPlayerIds = followRows.filter((f) => f.followed_type === "player").map((f) => f.followed_id);

  // A favourite club picked at onboarding counts as "yours" for the purposes
  // of this page even if the user never pressed Follow on it — it is the one
  // personalisation signal every completed onboarding produces.
  const matchdayTeamIds = [
    ...new Set([...followedTeamIds, ...(profile.favourite_team_id ? [profile.favourite_team_id] : [])]),
  ];

  const [
    todayFixturesResult,
    { data: xpTotal },
    { data: fantasyTeams },
    { data: myTeamRows },
    followedPlayers,
    transferPulse,
    predictionSummary,
    { notifications, unreadCount },
  ] = await Promise.all([
    supabase
      .from("fixtures")
      .select(FIXTURE_SELECT)
      .gte("kickoff_at", startOfDay.toISOString())
      .lt("kickoff_at", endOfDay.toISOString())
      .order("kickoff_at", { ascending: true })
      .limit(TODAY_FIXTURES_SCAN_LIMIT),
    // Single aggregate round trip instead of fetching every xp_ledger row
    // and summing in JS (RECOMMENDATIONS item 36) — see get_xp_total in
    // supabase/migrations/0023_xp_total_and_sync_run_pruning.sql.
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
    loadTransferPulse(supabase, matchdayTeamIds, followedPlayerIds, TRANSFER_PULSE_SHOWN),
    loadPredictionSummary(supabase, profile.id),
    getRecentNotifications(),
  ]);

  // "No football today" is a real and common answer; "KIVO could not read the
  // fixture list" is not the same sentence and must not borrow its words.
  const todayFixturesOutcome = readList(todayFixturesResult, "home.todayFixtures");
  const todayFixtures = todayFixturesOutcome.rows;

  const totalXp = xpTotal ?? 0;
  const teamNames = new Map<string, string>(
    (myTeamRows ?? []).map((t) => [t.id, t.short_name || t.name] as const),
  );

  // KIVO_NEXT_GEN KN-15 and KN-16. This used to build one `.or()` filter string
  // that grew by ~100 URL-encoded characters per followed team and carried no
  // `LIMIT` at all — so the more clubs a user followed, the closer the request
  // came to failing outright, and the page's own "your teams" section is
  // exactly what would vanish. fetchFixturesForTeams chunks the ids and asks
  // for each side with a plain `.in()` instead; see its module doc for why
  // merging sorted prefixes is exact rather than a heuristic.
  const [matchdayOutcome, upcomingOutcome] = await Promise.all([
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
  ]);

  const matchdayFixtures = matchdayOutcome.rows;
  const upcomingFixtures = upcomingOutcome.rows;

  // The gate. Four reads, and each of them is one the page cannot be honest
  // without: who the viewer follows, what is on today, and their own clubs'
  // fixtures in both directions. If any failed, /home would still render — a
  // greeting, a lead slot, section headings — and every one of those would be
  // making a claim about this person's football that KIVO cannot currently
  // support. `<LoadFailed>` says the true thing and offers the only useful
  // action, which is to try again.
  //
  // Everything *not* in this list is deliberately left tolerant: XP, fantasy,
  // transfers, notifications and the prediction summary each own one panel,
  // and one absent panel should not take down a home page that otherwise
  // works. That asymmetry is the judgement, not an oversight.
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

  // ── The lead slot (KN-37) ────────────────────────────────────────────────
  // Everything below is *facts*; the ranking itself lives in
  // src/lib/home-lead.ts and is unit-tested there.
  const liveRow = matchdayFixtures.find((f) => isLiveStatus(f.status)) ?? null;
  const nextRow = upcomingFixtures[0] ?? null;

  // The viewer's own call on the fixture that is about to lead the page — one
  // targeted lookup rather than fetching every prediction they have ever made.
  const { data: leadPrediction } = nextRow
    ? await supabase
        .from("predictions")
        .select("predicted_outcome")
        .eq("profile_id", profile.id)
        .eq("fixture_id", nextRow.id)
        .maybeSingle()
    : { data: null };

  // Next fantasy deadline for a season this viewer actually has a team in.
  // Skipped entirely for a non-player, so the ladder can never nag someone
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

  // Today's card across KIVO, minus the fixtures the viewer's own sections are
  // already showing — "the rest of today's football" has to actually be the
  // rest of it.
  const ownFixtureIds = new Set<string>([
    ...(leadFixtureId ? [leadFixtureId] : []),
    ...matchdayRest.map((f) => f.id),
  ]);
  const allTodayFixtures = todayFixtures as unknown as FixtureRowShape[];
  const topMatches = allTodayFixtures.filter((f) => !ownFixtureIds.has(f.id)).slice(0, TODAY_FIXTURES_SHOWN);

  const followedTeamIdSet = new Set(matchdayTeamIds);
  const [trendingRooms, fantasySummary] = await Promise.all([
    loadTrendingRooms(supabase, allTodayFixtures, followedTeamIdSet, TRENDING_ROOMS_SHOWN),
    loadFantasySummary(
      supabase,
      (fantasyTeams ?? []).map((t) => t.id),
    ),
  ]);

  // ── The section ladder ───────────────────────────────────────────────────
  const facts: HomeSectionFacts = {
    now,
    lead,
    briefingLineCount: 0, // replaced below, once the briefing is composed
    unreadNotificationCount: unreadCount,
    clubsTodayCount: matchdayRest.length,
    hasLiveFollowedFixture: Boolean(liveRow) || matchdayRest.some((f) => isLiveStatus(f.status)),
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
    transferPulse: {
      count: transferPulse.length,
      latestAt: transferPulse[0]?.transferDate ?? null,
    },
    followedPlayerCount: followedPlayers.length,
    topMatchCount: topMatches.length,
    upcomingCount: upcomingRest.length,
    aiConfigured,
  };

  const briefingLines = buildHomeBriefing({
    now,
    clubsToday: {
      count: matchdayFixtures?.length ?? 0,
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

  // One switch, rendered in the order the ladder returned. Adding a section
  // means adding a case here and a rule there — never reordering this file.
  function renderSection(id: (typeof sections)[number]["id"], reason: string) {
    switch (id) {
      case "briefing":
        return <BriefingCard lines={briefingLines} aiConfigured={aiConfigured} />;

      case "notifications":
        return <NotificationsCard notifications={notifications.slice(0, NOTIFICATIONS_SHOWN)} reason={reason} />;

      case "clubs_today":
        return (
          <HomeSectionCard
            icon={<Flame className="h-4 w-4" strokeWidth={1.75} />}
            title="Also on today for your clubs"
            reason={reason}
            action={{ href: "/matches", label: "Matches" }}
          >
            <FixtureList fixtures={matchdayRest} />
          </HomeSectionCard>
        );

      case "fantasy":
        return fantasySummary ? (
          <FantasyCard
            summary={fantasySummary}
            deadlineAt={nextGameweek?.deadline_at ?? null}
            rosterConfirmed={rosterConfirmed}
            gameweekNumber={nextGameweek?.number ?? null}
            now={now}
            reason={reason}
          />
        ) : null;

      case "predictions":
        return predictionSummary ? <PredictionsCard summary={predictionSummary} now={now} reason={reason} /> : null;

      case "trending_rooms":
        return <TrendingRoomsCard rooms={trendingRooms} reason={reason} />;

      case "transfer_pulse":
        return <TransferPulseCard transfers={transferPulse} reason={reason} />;

      case "your_players":
        return <FollowedPlayersCard players={followedPlayers} reason={reason} />;

      case "top_matches":
        return (
          <HomeSectionCard
            icon={<Flame className="h-4 w-4" strokeWidth={1.75} />}
            title="Today across KIVO"
            reason={reason}
            action={{ href: "/matches", label: "All matches" }}
          >
            <FixtureList fixtures={topMatches} />
          </HomeSectionCard>
        );

      case "no_football_yet":
        // KN-36: with the app gated, this is the first thing a brand-new
        // account reads. It used to explain KIVO's admin tooling to them.
        // Same fact, told the way a football app would tell it, with
        // somewhere real to go.
        return (
          <HomeSectionCard
            icon={<Flame className="h-4 w-4" strokeWidth={1.75} />}
            title="Today across KIVO"
            reason={reason}
          >
            <p className="text-sm text-foreground-muted">
              No fixtures on today&apos;s card yet. The moment today&apos;s are in, they land here first.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="/teams"
                className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-surface-1 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-2"
              >
                Find your club
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
              </Link>
              <Link
                href="/social"
                className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-surface-1 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-2"
              >
                Open the feed
              </Link>
            </div>
          </HomeSectionCard>
        );

      case "upcoming":
        return (
          <HomeSectionCard
            icon={<Star className="h-4 w-4" strokeWidth={1.75} />}
            title="Your teams"
            reason={reason}
            action={{ href: "/profile/following", label: "Manage" }}
          >
            <FixtureList fixtures={upcomingRest} />
          </HomeSectionCard>
        );

      case "recently_viewed":
        // Renders nothing at all when localStorage is empty — the one section
        // whose contents the server genuinely cannot see.
        return <RecentlyViewedStrip />;

      case "community":
        return (
          <HomeSectionCard
            icon={<Users className="h-4 w-4" strokeWidth={1.75} />}
            title="Community"
            reason={reason}
            action={{ href: "/social", label: "Open" }}
          >
            <p className="text-sm text-foreground-muted">
              The KIVO feed is live. Share your take, react to posts, and follow the conversation.
            </p>
          </HomeSectionCard>
        );
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn className="flex flex-col gap-1">
        <Greeting statedHour={statedGreetingHour} />
        <h1 className="text-2xl font-semibold text-foreground">{firstName}, here&apos;s your football.</h1>
      </FadeIn>

      <FadeIn delay={0.06}>
        <HomeLeadCard lead={lead} />
      </FadeIn>

      <FadeIn delay={0.09} className="flex flex-col gap-2">
        <QuickActionsRow actions={quickActions} />
        {/* XP is only shown once there is some. A "0 XP" tile on a first
            session is exactly the kind of true-but-useless zero this page is
            not allowed to render. */}
        {totalXp > 0 && (
          <Link
            href="/rewards"
            className="kivo-focus self-start text-[11px] font-medium text-foreground-subtle hover:text-foreground-muted"
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

      <FadeIn delay={0.5}>
        <AiTeaser aiConfigured={aiConfigured} />
      </FadeIn>
    </div>
  );
}
