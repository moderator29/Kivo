import Link from "next/link";
import { Sparkles, Trophy, Target, Flame, Users, ArrowRight, Shield } from "lucide-react";
import Image from "next/image";
import { FadeIn } from "@/components/ui/fade-in";
import { getOrCreateProfile } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAiConfigured } from "@/lib/ai/client";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function TeamCrest({ crestUrl, name }: { crestUrl: string | null; name: string }) {
  if (crestUrl) {
    return <Image src={crestUrl} alt={name} width={24} height={24} className="h-6 w-6 shrink-0 object-contain" />;
  }
  return (
    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/5">
      <Shield className="h-3 w-3 text-foreground-subtle" strokeWidth={1.75} />
    </div>
  );
}

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

      <FadeIn delay={0.05} className="kivo-glass rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Today</h2>
          <Link href="/matches" className="flex items-center gap-1 text-xs font-medium text-kivo-cyan hover:text-kivo-cyan/80">
            All matches
            <ArrowRight className="h-3 w-3" strokeWidth={2} />
          </Link>
        </div>

        {hasLiveOrTodayMatches ? (
          <div className="mt-3 flex flex-col gap-2">
            {todayFixtures!.map((fixture) => {
              const hasScore = fixture.home_score !== null && fixture.away_score !== null;
              const live = fixture.status === "live" || fixture.status === "halftime";
              return (
                <Link
                  key={fixture.id}
                  href={`/matches/${fixture.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 transition hover:bg-white/5"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <TeamCrest crestUrl={fixture.home_team?.crest_url ?? null} name={fixture.home_team?.name ?? "Home"} />
                    <span className="truncate text-sm text-foreground">{fixture.home_team?.name ?? "Home"}</span>
                  </div>
                  <span className={`shrink-0 text-xs font-semibold ${live ? "text-live" : "text-foreground-subtle"}`}>
                    {hasScore ? `${fixture.home_score} – ${fixture.away_score}` : "vs"}
                  </span>
                  <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                    <span className="truncate text-right text-sm text-foreground">{fixture.away_team?.name ?? "Away"}</span>
                    <TeamCrest crestUrl={fixture.away_team?.crest_url ?? null} name={fixture.away_team?.name ?? "Away"} />
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-sm text-foreground-muted">
            No matches synced for today yet — the football data pipeline is admin-triggered, not automatic. Check{" "}
            <Link href="/matches" className="text-kivo-cyan hover:text-kivo-cyan/80">
              Matches
            </Link>{" "}
            for the latest.
          </p>
        )}
      </FadeIn>

      <FadeIn delay={0.1} className="grid grid-cols-3 gap-3">
        {[
          {
            icon: Trophy,
            label: "Fantasy",
            value: fantasyTeamCount ? "In league" : "—",
            href: "/fantasy",
          },
          {
            icon: Target,
            label: "Predictions",
            value: predictionCount !== null ? String(predictionCount) : "—",
            href: "/predictions",
          },
          { icon: Flame, label: "XP", value: profile ? `${totalXp}` : "—", href: "/rewards" },
        ].map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="kivo-glass flex flex-col items-center gap-1.5 rounded-xl px-3 py-4 text-center transition-all hover:-translate-y-0.5 hover:bg-white/[0.06]"
          >
            <stat.icon className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
            <span className="text-lg font-semibold text-foreground">{stat.value}</span>
            <span className="text-[11px] font-medium text-foreground-subtle">{stat.label}</span>
          </Link>
        ))}
      </FadeIn>

      <FadeIn delay={0.15}>
        <Link
          href="/ai"
          className="kivo-gradient-intelligence group flex items-center gap-3 rounded-2xl p-4 transition-opacity hover:opacity-90"
        >
          <Sparkles className="h-5 w-5 shrink-0 text-kivo-white" strokeWidth={1.75} />
          <p className="flex-1 text-sm font-medium text-kivo-white">
            {aiConfigured
              ? "AI Copilot — ask anything about your teams, players and matches."
              : "AI Copilot is coming — grounded answers about your teams, players and matches."}
          </p>
          <ArrowRight className="h-4 w-4 shrink-0 text-kivo-white/80 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </FadeIn>

      <FadeIn delay={0.2} className="kivo-glass rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
            <Users className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
            Community
          </h2>
        </div>
        <p className="mt-3 text-sm text-foreground-muted">
          The KIVO feed is live — share your take, react to posts, and follow the conversation.
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
