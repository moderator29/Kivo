import Link from "next/link";
import { Sparkles, Trophy, Target, Flame, Users, ArrowRight } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { getOrCreateProfile } from "@/lib/profile";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function HomePage() {
  // Routed through KIVO's own profile rather than calling Clerk directly —
  // consistent with the rest of the app, and never throws if Clerk/Supabase
  // aren't configured (see lib/profile.ts), unlike currentUser() would.
  const profile = await getOrCreateProfile();
  const firstName = profile?.display_name?.split(" ")[0] || profile?.username || "there";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 lg:px-8">
      <FadeIn>
        <p className="text-sm font-medium text-foreground-subtle">{greeting()}</p>
        <h1 className="text-2xl font-semibold text-foreground">{firstName}, here&apos;s your football.</h1>
      </FadeIn>

      {/* Live rail — collapses to an honest "next up" state until a data provider is connected */}
      <FadeIn delay={0.05} className="kivo-glass rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Live now</h2>
          <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-subtle">
            Connecting data
          </span>
        </div>
        <p className="mt-3 text-sm text-foreground-muted">
          Live scores go here the moment KIVO&apos;s football data provider is connected. For now, jump into the
          community below — that part&apos;s real.
        </p>
      </FadeIn>

      {/* Compact stat strip — fantasy / predictions / XP, honestly not-yet-live */}
      <FadeIn delay={0.1} className="grid grid-cols-3 gap-3">
        {[
          { icon: Trophy, label: "Fantasy", value: "—", href: "/fantasy" },
          { icon: Target, label: "Predictions", value: "—", href: "/predictions" },
          { icon: Flame, label: "Streak", value: "—", href: "/rewards" },
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

      {/* AI insight teaser — single line, expands only once the Copilot is live */}
      <FadeIn delay={0.15}>
        <Link
          href="/ai"
          className="kivo-gradient-intelligence group flex items-center gap-3 rounded-2xl p-4 transition-opacity hover:opacity-90"
        >
          <Sparkles className="h-5 w-5 shrink-0 text-kivo-white" strokeWidth={1.75} />
          <p className="flex-1 text-sm font-medium text-kivo-white">
            AI Copilot is coming — grounded answers about your teams, players and matches.
          </p>
          <ArrowRight className="h-4 w-4 shrink-0 text-kivo-white/80 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </FadeIn>

      {/* Social — the real, working part of MVP */}
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
