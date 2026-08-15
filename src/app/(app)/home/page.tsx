import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Trophy, Target, Flame, Users, Star, ArrowRight } from "lucide-react";
import kivoActionArtwork from "../../../../public/brand/kivo-artwork-action.webp";
import { FadeIn } from "@/components/ui/fade-in";
import { StatTile } from "@/components/home/stat-tile";
import { FixtureRow } from "@/components/home/fixture-row";
import { AiTeaser } from "@/components/home/ai-teaser";
import { RecentlyViewedStrip } from "@/components/home/recently-viewed-strip";
import { TeamCrest } from "@/components/ui/team-crest";
import { getOrCreateProfile } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAiConfigured } from "@/lib/ai/client";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export const metadata: Metadata = { title: "Home" };

export default async function HomePage() {
  // Routed through KIVO's own profile rather than calling Clerk directly —
  // consistent with the rest of the app, and never throws if Clerk/Supabase
  // aren't configured (see lib/profile.ts), unlike currentUser() would.
  const profile = await getOrCreateProfile();
  const firstName = profile?.display_name?.split(" ")[0] || profile?.username || "there";
  const aiConfigured = isAiConfigured();

  const supabase = createServerSupabaseClient();

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

  const [{ data: todayFixtures }, { data: xpTotal }, { count: predictionCount }, { count: fantasyTeamCount }] =
    await Promise.all([
      supabase
        .from("fixtures")
        .select(
          `id, kickoff_at, status, home_score, away_score,
           home_team:teams!fixtures_home_team_id_fkey(name, crest_url),
           away_team:teams!fixtures_away_team_id_fkey(name, crest_url)`,
        )
        .gte("kickoff_at", startOfDay.toISOString())
        .lt("kickoff_at", endOfDay.toISOString())
        .order("kickoff_at", { ascending: true })
        .limit(3),
      // Single aggregate round trip instead of fetching every xp_ledger row
      // and summing in JS (RECOMMENDATIONS item 36) — see get_xp_total in
      // supabase/migrations/0023_xp_total_and_sync_run_pruning.sql.
      profile ? supabase.rpc("get_xp_total", { p_profile_id: profile.id }) : Promise.resolve({ data: null }),
      profile
        ? supabase
            .from("predictions")
            .select("id", { count: "exact", head: true })
            .eq("profile_id", profile.id)
            .is("locked_at", null)
        : Promise.resolve({ count: null }),
      profile
        ? supabase.from("fantasy_teams").select("id", { count: "exact", head: true }).eq("owner_profile_id", profile.id)
        : Promise.resolve({ count: null }),
    ]);

  const totalXp = xpTotal ?? 0;

  // "Your teams" — the one place `follows` actually changes what's on screen
  // (RECOMMENDATIONS item 13). Two-step because `followed_id` has no DB-level
  // FK (it's polymorphic across team/player/competition), so the team ids
  // have to be resolved before fixtures can be filtered on them.
  const { data: followedTeamRows } = profile
    ? await supabase.from("follows").select("followed_id").eq("follower_profile_id", profile.id).eq("followed_type", "team")
    : { data: null };
  const followedTeamIds = (followedTeamRows ?? []).map((f) => f.followed_id);

  // RECOMMENDATIONS item 174: "Your matchday" — today's real fixtures
  // (same date window as "Today" above) filtered down to the teams this
  // profile actually follows plus their favourite_team_id, deduped. Distinct
  // from "Today" (every fixture, no filter) and from "Your teams" below
  // (upcoming fixtures for followed teams, not day-scoped) — this is the
  // combination neither of those already covers: what's actually on today,
  // for you specifically.
  const matchdayTeamIds = [...new Set([...followedTeamIds, ...(profile?.favourite_team_id ? [profile.favourite_team_id] : [])])];

  const { data: matchdayFixtures } = matchdayTeamIds.length
    ? await supabase
        .from("fixtures")
        .select(
          `id, kickoff_at, status, home_score, away_score,
           home_team:teams!fixtures_home_team_id_fkey(name, crest_url),
           away_team:teams!fixtures_away_team_id_fkey(name, crest_url)`,
        )
        .gte("kickoff_at", startOfDay.toISOString())
        .lt("kickoff_at", endOfDay.toISOString())
        .or(matchdayTeamIds.map((id) => `home_team_id.eq.${id},away_team_id.eq.${id}`).join(","))
        .order("kickoff_at", { ascending: true })
    : { data: null };

  const { data: yourTeamsFixtures } = followedTeamIds.length
    ? await supabase
        .from("fixtures")
        .select(
          `id, kickoff_at,
           home_team:teams!fixtures_home_team_id_fkey(name, crest_url),
           away_team:teams!fixtures_away_team_id_fkey(name, crest_url)`,
        )
        .or(followedTeamIds.map((id) => `home_team_id.eq.${id},away_team_id.eq.${id}`).join(","))
        .eq("status", "scheduled")
        .gt("kickoff_at", new Date().toISOString())
        .order("kickoff_at", { ascending: true })
        .limit(5)
    : { data: null };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 lg:px-8">
      <FadeIn className="relative flex flex-col items-center gap-2 text-center lg:flex-row lg:items-center lg:justify-between lg:gap-6 lg:text-left">
        <div>
          <p className="text-sm font-medium text-foreground-subtle">{greeting()}</p>
          <h1 className="text-2xl font-semibold text-foreground">{firstName}, here&apos;s your football.</h1>
        </div>
        {/* Second of the three commissioned KIVO artwork pieces placed off the
            landing page this session (see the hero's placement comment in
            src/app/page.tsx for the trademark check they went through). A
            small decorative accent next to the greeting, not a replacement
            for any real data below it — same edge-masked, floating treatment
            as the hero, scaled down to fit a dashboard header instead of a
            hero section. */}
        <div className="kivo-artwork-float kivo-artwork-mask relative -mt-2 h-28 w-44 shrink-0 sm:h-32 sm:w-52 lg:mt-0 lg:h-28 lg:w-44">
          <Image
            src={kivoActionArtwork}
            alt=""
            fill
            className="object-contain"
            sizes="(min-width: 1024px) 176px, 208px"
          />
        </div>
      </FadeIn>

      <RecentlyViewedStrip />

      <FadeIn delay={0.08} className="kivo-glass rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Today</h2>
          <Link href="/matches" className="flex items-center gap-1 text-xs font-medium text-kivo-cyan hover:text-kivo-cyan/80">
            All matches
            <ArrowRight className="h-3 w-3" strokeWidth={2} />
          </Link>
        </div>

        {todayFixtures && todayFixtures.length > 0 ? (
          <div className="mt-3 flex flex-col gap-2">
            {todayFixtures.map((fixture, index) => {
              const hasScore = fixture.home_score !== null && fixture.away_score !== null;
              const live = fixture.status === "live" || fixture.status === "halftime";
              return (
                <FixtureRow
                  key={fixture.id}
                  href={`/matches/${fixture.id}`}
                  homeCrest={<TeamCrest crestUrl={fixture.home_team?.crest_url ?? null} name={fixture.home_team?.name ?? "Home"} size={24} />}
                  homeName={fixture.home_team?.name ?? "Home"}
                  awayCrest={<TeamCrest crestUrl={fixture.away_team?.crest_url ?? null} name={fixture.away_team?.name ?? "Away"} size={24} />}
                  awayName={fixture.away_team?.name ?? "Away"}
                  scoreLabel={hasScore ? `${fixture.home_score} – ${fixture.away_score}` : "vs"}
                  live={live}
                  index={index}
                />
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-sm text-foreground-muted">
            No matches synced for today yet. The football data pipeline is admin-triggered, not automatic. Check{" "}
            <Link href="/matches" className="text-kivo-cyan hover:text-kivo-cyan/80">
              Matches
            </Link>{" "}
            for the latest.
          </p>
        )}
      </FadeIn>

      {/* RECOMMENDATIONS item 174: only rendered when there's actually
          something to show it against — a profile with no followed/favourite
          team just sees "Your teams" below invite them to follow one, so
          this doesn't duplicate that empty state. */}
      {matchdayTeamIds.length > 0 && (
        <FadeIn delay={0.1} className="kivo-glass-brand rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
              <Flame className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
              Your matchday
            </h2>
          </div>

          {matchdayFixtures && matchdayFixtures.length > 0 ? (
            <div className="mt-3 flex flex-col gap-2">
              {matchdayFixtures.map((fixture, index) => {
                const hasScore = fixture.home_score !== null && fixture.away_score !== null;
                const live = fixture.status === "live" || fixture.status === "halftime";
                return (
                  <FixtureRow
                    key={fixture.id}
                    href={`/matches/${fixture.id}`}
                    homeCrest={<TeamCrest crestUrl={fixture.home_team?.crest_url ?? null} name={fixture.home_team?.name ?? "Home"} size={24} />}
                    homeName={fixture.home_team?.name ?? "Home"}
                    awayCrest={<TeamCrest crestUrl={fixture.away_team?.crest_url ?? null} name={fixture.away_team?.name ?? "Away"} size={24} />}
                    awayName={fixture.away_team?.name ?? "Away"}
                    scoreLabel={hasScore ? `${fixture.home_score} – ${fixture.away_score}` : "vs"}
                    live={live}
                    index={index}
                  />
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-sm text-foreground-muted">
              None of your followed teams play today.
            </p>
          )}
        </FadeIn>
      )}

      <FadeIn delay={0.12} className="kivo-glass rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
            <Star className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
            Your teams
          </h2>
          {followedTeamIds.length > 0 && (
            <Link
              href="/profile/following"
              className="flex items-center gap-1 text-xs font-medium text-kivo-cyan hover:text-kivo-cyan/80"
            >
              Manage
              <ArrowRight className="h-3 w-3" strokeWidth={2} />
            </Link>
          )}
        </div>

        {!profile ? (
          <p className="mt-3 text-sm text-foreground-muted">
            <Link href="/sign-up?redirect_url=%2Fhome" className="text-kivo-cyan hover:text-kivo-cyan/80">
              Sign up to follow a team
            </Link>{" "}
            and see their fixtures here.
          </p>
        ) : followedTeamIds.length === 0 ? (
          <p className="mt-3 text-sm text-foreground-muted">
            You&apos;re not following any teams yet. Star a team on its page and its fixtures will show up here.
          </p>
        ) : yourTeamsFixtures && yourTeamsFixtures.length > 0 ? (
          <div className="mt-3 flex flex-col gap-2">
            {yourTeamsFixtures.map((fixture, index) => (
              <FixtureRow
                key={fixture.id}
                href={`/matches/${fixture.id}`}
                homeCrest={<TeamCrest crestUrl={fixture.home_team?.crest_url ?? null} name={fixture.home_team?.name ?? "Home"} size={24} />}
                homeName={fixture.home_team?.name ?? "Home"}
                awayCrest={<TeamCrest crestUrl={fixture.away_team?.crest_url ?? null} name={fixture.away_team?.name ?? "Away"} size={24} />}
                awayName={fixture.away_team?.name ?? "Away"}
                scoreLabel={new Date(fixture.kickoff_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                live={false}
                index={index}
              />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-foreground-muted">No upcoming fixtures synced yet for the teams you follow.</p>
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
            value: predictionCount !== null ? String(predictionCount) : "-",
            href: "/predictions",
            brand: false,
          },
          {
            icon: <Flame className="h-4 w-4" strokeWidth={1.75} />,
            label: "XP",
            value: profile ? `${totalXp}` : "-",
            href: "/rewards",
            brand: true,
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
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
            <Users className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
            Community
          </h2>
        </div>
        <p className="mt-3 text-sm text-foreground-muted">
          The KIVO feed is live. Share your take, react to posts, and follow the conversation.
        </p>
        <Link
          href="/social"
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-white/[0.06] px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-white/[0.1]"
        >
          Open Social
          <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
        </Link>
      </FadeIn>
    </div>
  );
}
