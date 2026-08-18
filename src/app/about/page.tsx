import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { FadeIn } from "@/components/ui/fade-in";
import { FeatureCard } from "@/components/marketing/feature-card";

export const metadata: Metadata = {
  title: "About | KIVO",
  description:
    "KIVO is a football home built for how fans actually watch, argue and play: live scores, Match Rooms, an AI Copilot grounded in real data, and fantasy, starting in Nigeria.",
};

const WHAT_YOU_FIND = [
  {
    icon: "/assets/icons/navigation/live-scores.webp",
    title: "Live scores, verified",
    description: "Real fixtures, real scores, synced from live football data. Nothing invented, nothing guessed.",
  },
  {
    icon: "/assets/icons/social/chat-social.webp",
    title: "Match Rooms",
    description: "A live home for every fixture, so the conversation happens where the match is, not off in a group chat.",
  },
  {
    icon: "/assets/icons/navigation/ai-copilot.webp",
    title: "AI Copilot, grounded",
    description: "Ask about a match or a player and get an answer built from KIVO's own verified data, not a guess.",
  },
  {
    icon: "/assets/icons/fantasy-rewards/fantasy.webp",
    title: "Fantasy & predictions",
    description: "Build a squad, back your instincts, and climb a leaderboard with friends, for bragging rights.",
  },
];

export default function AboutPage() {
  return (
    <MarketingPageShell>
      <section className="mx-auto flex w-full max-w-4xl flex-col items-center gap-6 px-4 pb-14 pt-8 text-center sm:px-6 sm:pt-12 lg:px-12 lg:pb-20 lg:pt-16">
        <FadeIn>
          <span className="rounded-full border border-hairline px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            About KIVO
          </span>
        </FadeIn>
        <FadeIn delay={0.08}>
          <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            A football home built for how fans actually watch, argue and play.
          </h1>
        </FadeIn>
        <FadeIn delay={0.16}>
          <p className="max-w-xl text-base leading-relaxed text-foreground-muted">
            Most football apps pick one lane: scores, or social, or fantasy. Fans don&apos;t live in one lane. You check
            the score, argue about the sub that should have happened, back your gut on the next result, and still
            want your fantasy team to hold up, all in the same ten minutes. KIVO is built around that, in one place.
          </p>
        </FadeIn>
      </section>

      <section className="mx-auto w-full max-w-4xl px-4 pb-14 sm:px-6 lg:px-12 lg:pb-20">
        <FadeIn className="kivo-glass-brand flex flex-col gap-4 rounded-3xl p-6 sm:p-8">
          <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">Why we&apos;re building it</h2>
          <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
            Football is followed hardest in places the big platforms treat as an afterthought. KIVO starts in
            Nigeria, for fans who follow the game as closely as anyone anywhere, and builds the product around what
            actually happens on a matchday: a live score you can trust, a place to react in real time, a fantasy
            squad worth arguing about, and an assistant that actually knows what it&apos;s talking about instead of
            filling gaps with confident-sounding guesses.
          </p>
          <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
            It&apos;s built by a small team, in the open, with no pretense that it&apos;s finished. What ships is what
            works today; what&apos;s coming stays honestly labeled &ldquo;Coming Soon&rdquo; instead of faked to look
            further along than it is.
          </p>
        </FadeIn>
      </section>

      <section className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pb-14 sm:px-6 lg:px-12 lg:pb-20">
        <FadeIn className="flex flex-col items-center gap-3 text-center">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">What&apos;s in KIVO</span>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            One home for the whole matchday.
          </h2>
        </FadeIn>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {WHAT_YOU_FIND.map((item, index) => (
            <FeatureCard key={item.title} icon={item.icon} title={item.title} description={item.description} index={index} />
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-4xl px-4 pb-14 sm:px-6 lg:px-12 lg:pb-20">
        <FadeIn className="kivo-glass-brand relative flex flex-col gap-4 rounded-3xl p-6 sm:p-8">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Our one hard rule</span>
          <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            We will never invent a stat, a rumor, or a ranking to fill space.
          </h2>
          <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
            It would be easy to make KIVO look more complete by quietly filling gaps: a placeholder score, a made-up
            transfer rumor, a ranking nobody actually calculated. We don&apos;t do that, anywhere in the product.
            Live scores come from a real football data provider. The AI Copilot is told explicitly to say &ldquo;KIVO
            doesn&apos;t have that yet&rdquo; rather than guess. If a feature isn&apos;t connected to real data yet,
            it&apos;s labeled &ldquo;Coming Soon&rdquo; instead of faked. This isn&apos;t a marketing line, it&apos;s
            a constraint we build against every time we ship something new.
          </p>
        </FadeIn>
      </section>

      <section className="mx-auto flex w-full max-w-4xl flex-col items-center gap-6 px-4 pb-16 text-center sm:px-6 lg:px-12 lg:pb-24">
        <FadeIn className="flex flex-col items-center gap-4">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Come see for yourself.
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-foreground-muted sm:text-base">
            Scores, standings and the Match Centre are open to look around, no account needed. Sign up when you want
            to play.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/home"
              className="kivo-gradient-prime flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-on-accent kivo-glow kivo-raise focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              Explore KIVO
              <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
            </Link>
            <Link
              href="/sign-up"
              className="kivo-glass-sharp kivo-raise flex items-center justify-center rounded-xl px-6 py-3 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              Create free account
            </Link>
          </div>
        </FadeIn>
      </section>
    </MarketingPageShell>
  );
}
