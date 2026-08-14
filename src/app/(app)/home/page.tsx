import type { Metadata } from "next";
import Link from "next/link";
import { Trophy, Target, Flame, Users, ArrowRight } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { StatTile } from "@/components/home/stat-tile";
import { FixtureRow } from "@/components/home/fixture-row";
import { AiTeaser } from "@/components/home/ai-teaser";
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

  const [{ data: todayFixtures }, { data: xpEntries }, { count: predictionCount }, { count: fantasyTeamCount }] =
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
      profile ? supabase.from("xp_ledger").select("amount").eq("profile_id", profile.id) : Promise.resolve({ data: null }),
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

  const totalXp = (xpEntries ?? []).reduce((sum, entry) => sum + entry.amount, 0);
  const hasLiveOrTodayMatches = (todayFixtures?.length ?? 0) > 0;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 lg:px-8">
      <FadeIn>
        <p className="text-sm font-medium text-foreground-subtle">{greeting()}</p>
        <h1 className="text-2xl font-semibold text-foreground">{firstName}, here&apos;s your football.</h1>
      </FadeIn>

      <FadeIn delay={0.08} className="kivo-glass rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Today</h2>
          <Link href="/matches" className="flex items-center gap-1 text-xs font-medium text-kivo-cyan hover:text-kivo-cyan/80">
            All matches
            <ArrowRight className="h-3 w-3" strokeWidth={2} />
          </Link>
        </div>

        {hasLiveOrTodayMatches ? (
          <div className="mt-3 flex flex-col gap-2">
            {todayFixtures!.map((fixture, index) => {
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

      <div className="grid grid-cols-3 gap-3">
        {[
          {
            icon: <Trophy className="h-4 w-4" strokeWidth={1.75} />,
            label: "Fantasy",
            value: fantasyTeamCount ? "In league" : "–",
            href: "/fantasy",
            brand: false,
          },
          {
            icon: <Target className="h-4 w-4" strokeWidth={1.75} />,
            label: "Predictions",
            value: predictionCount !== null ? String(predictionCount) : "–",
            href: "/predictions",
            brand: false,
          },
          {
            icon: <Flame className="h-4 w-4" strokeWidth={1.75} />,
            label: "XP",
            value: profile ? `${totalXp}` : "–",
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
