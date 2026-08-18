import type { Metadata } from "next";
import Link from "next/link";
import { Trophy, Target, Flame, Users, Star, ArrowRight } from "lucide-react";
import { DISPLAY_LOCALE } from "@/lib/format";
import { FadeIn } from "@/components/ui/fade-in";
import { StatTile } from "@/components/home/stat-tile";
import { FixtureRow } from "@/components/home/fixture-row";
import { HomeLeadCard } from "@/components/home/home-lead";
import { AiTeaser } from "@/components/home/ai-teaser";
import { RecentlyViewedStrip } from "@/components/home/recently-viewed-strip";
import { TeamCrest } from "@/components/ui/team-crest";
import { ProfileUnavailable } from "@/components/auth/profile-unavailable";
import { getOrCreateProfile } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAiConfigured } from "@/lib/ai/client";
import { selectHomeLead, type LeadFixture } from "@/lib/home-lead";
import { PREDICTION_OUTCOME_LABEL, type PredictionOutcome } from "@/lib/predictions";
import { isLiveStatus, type FixtureStatus } from "@/lib/football/fixture-status";
import { fetchFixturesForTeams } from "@/lib/football/fixtures-by-team";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export const metadata: Metadata = { title: "Home" };

/**
 * KIVO_NEXT_GEN KN-16: neither followed-team fixture query had a `LIMIT`. The
 * "today" one renders a section headed by whatever is live, and the "upcoming"
 * one already asked for 6 — these make both ceilings explicit rather than
 * relying on a followed-team set staying small.
 */
const MATCHDAY_FIXTURES_LIMIT = 20;
const UPCOMING_FIXTURES_LIMIT = 6;

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

export default async function HomePage() {
  // Routed through KIVO's own profile rather than reading the auth user
  // directly — consistent with the rest of the app, and never throws if
  // Supabase isn't configured for this environment (see lib/profile.ts).
  const profile = await getOrCreateProfile();

  // The (app) layout already guarantees a signed-in viewer with a real
  // profile row, so a null here is not a guest — it is a transient read
  // failure between that check and this one. Saying so is honest; the old
  // code's "Sign up to follow a team" branch told a signed-in user they were
  // signed out (KN-39).
  if (!profile) return <ProfileUnavailable />;

  const firstName = profile.display_name?.split(" ")[0] || profile.username || "there";
  const aiConfigured = isAiConfigured();

  const supabase = createServerSupabaseClient();

  // One clock for the whole render: the lead ladder, the "today" window and
  // the "upcoming" cutoff all have to agree, or a fixture can be simultaneously
  // "on today" and "in the past".
  const nowDate = new Date();
  const now = nowDate.getTime();
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

  // "Your teams" — the one place `follows` actually changes what's on screen
  // (RECOMMENDATIONS item 13). Two-step because `followed_id` has no DB-level
  // FK (it's polymorphic across team/player/competition), so the team ids
  // have to be resolved before fixtures can be filtered on them.
  const { data: followedTeamRows } = await supabase
    .from("follows")
    .select("followed_id")
    .eq("follower_profile_id", profile.id)
    .eq("followed_type", "team");
  const followedTeamIds = (followedTeamRows ?? []).map((f) => f.followed_id);

  // A favourite club picked at onboarding counts as "yours" for the purposes
  // of this page even if the user never pressed Follow on it — it is the one
  // personalisation signal every completed onboarding produces.
  const matchdayTeamIds = [
    ...new Set([...followedTeamIds, ...(profile.favourite_team_id ? [profile.favourite_team_id] : [])]),
  ];

  const [{ data: todayFixtures }, { data: xpTotal }, { count: openPredictionCount }, { data: fantasyTeams }, { data: myTeamRows }] =
    await Promise.all([
      supabase
        .from("fixtures")
        .select(FIXTURE_SELECT)
        .gte("kickoff_at", startOfDay.toISOString())
        .lt("kickoff_at", endOfDay.toISOString())
        .order("kickoff_at", { ascending: true })
        .limit(3),
      // Single aggregate round trip instead of fetching every xp_ledger row
      // and summing in JS (RECOMMENDATIONS item 36) — see get_xp_total in
      // supabase/migrations/0023_xp_total_and_sync_run_pruning.sql.
      supabase.rpc("get_xp_total", { p_profile_id: profile.id }),
      supabase
        .from("predictions")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", profile.id)
        .is("locked_at", null),
      // Fetched as rows rather than a count because the lead ladder needs the
      // league's season to find this viewer's next gameweek deadline.
      supabase
        .from("fantasy_teams")
        .select("id, league:fantasy_leagues!inner(season_id)")
        .eq("owner_profile_id", profile.id),
      matchdayTeamIds.length
        ? supabase.from("teams").select("id, name, short_name").in("id", matchdayTeamIds)
        : Promise.resolve({ data: null }),
    ]);

  const totalXp = xpTotal ?? 0;
  const fantasyTeamCount = fantasyTeams?.length ?? 0;
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
  const [matchdayFixtures, upcomingFixtures] = await Promise.all([
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

  // ── The lead slot (KN-37) ────────────────────────────────────────────────
  // Everything below is *facts*; the ranking itself lives in
  // src/lib/home-lead.ts and is unit-tested there.
  const liveRow = (matchdayFixtures ?? []).find((f) => isLiveStatus(f.status)) ?? null;
  const nextRow = (upcomingFixtures ?? [])[0] ?? null;

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

  const lead = selectHomeLead({
    now,
    followedTeamCount: matchdayTeamIds.length,
    liveFixture: liveRow ? toLeadFixture(liveRow, teamNames) : null,
    nextFixture: nextRow ? toLeadFixture(nextRow, teamNames) : null,
    nextFixturePrediction: leadPrediction
      ? PREDICTION_OUTCOME_LABEL[leadPrediction.predicted_outcome as PredictionOutcome]
      : null,
    openPredictionCount: openPredictionCount ?? 0,
    fantasy: nextGameweek
      ? {
          gameweekNumber: nextGameweek.number,
          deadlineAt: nextGameweek.deadline_at,
          rosterConfirmed: (confirmedRosterCount ?? 0) > 0,
        }
      : null,
  });

  // Whatever the lead is already showing is removed from the lists below it —
  // a page whose headline and its own supporting list repeat the same fixture
  // reads as a bug, not as emphasis.
  const leadFixtureId = "fixture" in lead ? lead.fixture.id : null;
  const matchdayRest = (matchdayFixtures ?? []).filter((f) => f.id !== leadFixtureId);
  const upcomingRest = (upcomingFixtures ?? []).filter((f) => f.id !== leadFixtureId).slice(0, 5);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground-subtle">{greeting()}</p>
        <h1 className="text-2xl font-semibold text-foreground">{firstName}, here&apos;s your football.</h1>
      </FadeIn>

      <FadeIn delay={0.06}>
        <HomeLeadCard lead={lead} />
      </FadeIn>

      <RecentlyViewedStrip />

      {matchdayRest.length > 0 && (
        <FadeIn delay={0.1} className="kivo-glass rounded-2xl p-5">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            <Flame className="h-4 w-4 text-accent" strokeWidth={1.75} />
            Also on today for your clubs
          </h2>
          <div className="mt-3 flex flex-col gap-2">
            {matchdayRest.map((fixture, index) => {
              const hasScore = fixture.home_score !== null && fixture.away_score !== null;
              return (
                <FixtureRow
                  key={fixture.id}
                  href={`/matches/${fixture.id}`}
                  homeCrest={<TeamCrest crestUrl={fixture.home_team?.crest_url ?? null} name={fixture.home_team?.name ?? "Home"} size={24} />}
                  homeName={fixture.home_team?.name ?? "Home"}
                  awayCrest={<TeamCrest crestUrl={fixture.away_team?.crest_url ?? null} name={fixture.away_team?.name ?? "Away"} size={24} />}
                  awayName={fixture.away_team?.name ?? "Away"}
                  scoreLabel={hasScore ? `${fixture.home_score} – ${fixture.away_score}` : "vs"}
                  live={isLiveStatus(fixture.status)}
                  index={index}
                />
              );
            })}
          </div>
        </FadeIn>
      )}

      <FadeIn delay={0.14} className="kivo-glass rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Today across KIVO</h2>
          <Link href="/matches" className="flex items-center gap-1 text-xs font-medium text-accent hover:text-accent/80">
            All matches
            <ArrowRight className="h-3 w-3" strokeWidth={2} />
          </Link>
        </div>

        {todayFixtures && todayFixtures.length > 0 ? (
          <div className="mt-3 flex flex-col gap-2">
            {todayFixtures.map((fixture, index) => {
              const hasScore = fixture.home_score !== null && fixture.away_score !== null;
              return (
                <FixtureRow
                  key={fixture.id}
                  href={`/matches/${fixture.id}`}
                  homeCrest={<TeamCrest crestUrl={fixture.home_team?.crest_url ?? null} name={fixture.home_team?.name ?? "Home"} size={24} />}
                  homeName={fixture.home_team?.name ?? "Home"}
                  awayCrest={<TeamCrest crestUrl={fixture.away_team?.crest_url ?? null} name={fixture.away_team?.name ?? "Away"} size={24} />}
                  awayName={fixture.away_team?.name ?? "Away"}
                  scoreLabel={hasScore ? `${fixture.home_score} – ${fixture.away_score}` : "vs"}
                  live={isLiveStatus(fixture.status)}
                  index={index}
                />
              );
            })}
          </div>
        ) : (
          // KN-36: this is the single highest-traffic empty state in the
          // product — with the app gated, it is the first thing a brand-new
          // account reads. It used to explain KIVO's admin tooling to them
          // ("the football data pipeline is admin-triggered, not automatic").
          // Same fact, told the way a football app would tell it, with
          // somewhere real to go.
          <div className="mt-3">
            <p className="text-sm text-foreground-muted">
              No fixtures on today&apos;s card yet. KIVO only lists matches it has actually verified — the moment today&apos;s
              are in, they land here first.
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
          </div>
        )}
      </FadeIn>

      <FadeIn delay={0.18} className="kivo-glass rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            <Star className="h-4 w-4 text-accent" strokeWidth={1.75} />
            Your teams
          </h2>
          {matchdayTeamIds.length > 0 && (
            <Link
              href="/profile/following"
              className="flex items-center gap-1 text-xs font-medium text-accent hover:text-accent/80"
            >
              Manage
              <ArrowRight className="h-3 w-3" strokeWidth={2} />
            </Link>
          )}
        </div>

        {matchdayTeamIds.length === 0 ? (
          <p className="mt-3 text-sm text-foreground-muted">
            You&apos;re not following any clubs yet. Star one on its page and its fixtures show up here.
          </p>
        ) : upcomingRest.length > 0 ? (
          <div className="mt-3 flex flex-col gap-2">
            {upcomingRest.map((fixture, index) => (
              <FixtureRow
                key={fixture.id}
                href={`/matches/${fixture.id}`}
                homeCrest={<TeamCrest crestUrl={fixture.home_team?.crest_url ?? null} name={fixture.home_team?.name ?? "Home"} size={24} />}
                homeName={fixture.home_team?.name ?? "Home"}
                awayCrest={<TeamCrest crestUrl={fixture.away_team?.crest_url ?? null} name={fixture.away_team?.name ?? "Away"} size={24} />}
                awayName={fixture.away_team?.name ?? "Away"}
                scoreLabel={new Date(fixture.kickoff_at).toLocaleDateString(DISPLAY_LOCALE, { month: "short", day: "numeric" })}
                live={false}
                index={index}
              />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-foreground-muted">No upcoming fixtures synced yet for the clubs you follow.</p>
        )}
      </FadeIn>

      <div className="grid grid-cols-3 gap-3">
        {[
          {
            icon: <Trophy className="h-4 w-4" strokeWidth={1.75} />,
            label: "Fantasy",
            value: fantasyTeamCount ? "In league" : "-",
            href: "/fantasy",
            brand: false,
          },
          {
            icon: <Target className="h-4 w-4" strokeWidth={1.75} />,
            label: "Predictions",
            value: openPredictionCount !== null ? String(openPredictionCount) : "-",
            href: "/predictions",
            brand: false,
          },
          {
            icon: <Flame className="h-4 w-4" strokeWidth={1.75} />,
            label: "XP",
            value: `${totalXp}`,
            href: "/rewards",
            brand: false,
          },
        ].map((stat, index) => (
          <StatTile
            key={stat.label}
            href={stat.href}
            icon={stat.icon}
            value={stat.value}
            label={stat.label}
            brand={stat.brand}
            delay={0.2 + index * 0.06}
          />
        ))}
      </div>

      <FadeIn delay={0.4}>
        <AiTeaser aiConfigured={aiConfigured} />
      </FadeIn>

      <FadeIn delay={0.48} className="kivo-glass rounded-2xl p-5">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          <Users className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Community
        </h2>
        <p className="mt-3 text-sm text-foreground-muted">
          The KIVO feed is live. Share your take, react to posts, and follow the conversation.
        </p>
        <Link
          href="/social"
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-surface-1 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
        >
          Open Social
          <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
        </Link>
      </FadeIn>
    </div>
  );
}
