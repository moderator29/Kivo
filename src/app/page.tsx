import Link from "next/link";
import { ArrowRight, ShieldCheck, UserPlus, Sparkles } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { KivoMark } from "@/components/ui/kivo-mark";
import { FeatureCard } from "@/components/marketing/feature-card";
import { KivoMarkGlyph } from "@/components/ui/kivo-mark-glyph";

// This page used to be `"use client"` in full just so two elements could
// float via `motion.div` — that shipped React, `motion` and the whole page
// tree as client JS on the highest-traffic, most bounce-sensitive route.
// Every float below is a pure CSS keyframe (see the inline `<style>` in the
// hero section), same pattern as the aurora background and `KivoMarkGlyph`,
// so this stays a Server Component. See RECOMMENDATIONS.md item 73.
//
// Hero visual, revised three times now, and the history is worth keeping
// because two of the three revisions were forced by a real legal constraint
// rather than by taste:
// 1. The original hero used `kivo-trophy-crown.webp` at large, fully legible
//    size. At that size it bakes real competition marks — a Champions League
//    star-ball, and the Premier League, LaLiga, Serie A, Bundesliga and Ligue
//    1 crests — into one flattened promotional composite, plus silhouetted
//    athlete figures. That is real trademark exposure for a live commercial
//    product, so it was pulled.
// 2. Replaced with a hero built from KIVO's own UI language, then with
//    `kivo-artwork-hero.webp`, one of four commissioned pieces (each checked
//    individually against the same trademark / right-of-publicity issue as
//    #1 before use).
// 3. Now: no hero image at all, per founder direction. The commissioned
//    artwork and the scattered trophy texture are both gone from this page
//    and from the in-product surfaces that reused them. The hero is a single
//    centred column — the K mark at display size, then the headline. The
//    artwork files stay in public/brand/ rather than being deleted, since
//    they were commissioned and cleared and the decision here is a design
//    one, not a licensing one.

const PROOF_POINTS = [
  {
    icon: "/assets/icons/navigation/live-scores.webp",
    title: "Real football, verified",
    description: "Real fixtures, real scores, synced from live football data. Nothing invented, nothing guessed.",
  },
  {
    icon: "/assets/icons/navigation/ai-copilot.webp",
    title: "AI Copilot, grounded",
    description:
      "Ask why a match turned, compare players, or get a fantasy pick. Answered from KIVO's verified data, never guessed.",
  },
  {
    icon: "/assets/icons/social/chat-social.webp",
    title: "Match Rooms, alive",
    description: "Every fixture has a home for fans. React to goals in real time, not a comment section bolted on.",
  },
  {
    icon: "/assets/icons/fantasy-rewards/fantasy.webp",
    title: "Fantasy & predictions",
    description: "Build your squad, back your instincts, climb the leaderboard. With friends, not against a house.",
  },
];

const HOW_IT_WORKS = [
  {
    icon: ShieldCheck,
    title: "Browse free, no account needed",
    description:
      "Scores, standings, teams, players, Match Centre, the AI Copilot's public answers: all viewable the moment you land, exactly like Sofascore or Flashscore. No wall before the product.",
  },
  {
    icon: UserPlus,
    title: "Sign up only when you act",
    description:
      "Like a post, submit a prediction, build a fantasy squad, join the conversation: that's the moment KIVO asks you to sign up, and it takes you straight back to what you were doing.",
  },
  {
    icon: Sparkles,
    title: "Play, predict, and follow along",
    description:
      "Once you're in: build a fantasy squad, back your predictions, follow your club, and let the AI Copilot answer from KIVO's own verified data.",
  },
];

const FOOTER_LINKS: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: "Product",
    links: [
      { label: "Live scores", href: "/live" },
      { label: "Match Centre", href: "/matches" },
      { label: "Fantasy", href: "/fantasy" },
      { label: "Predictions", href: "/predictions" },
      { label: "AI Copilot", href: "/ai" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Terms of Service", href: "/terms" },
    ],
  },
];

export default function LandingPage() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip bg-background">
      <div className="kivo-aurora-page" aria-hidden="true">
        <span className="kivo-aurora-blob kivo-aurora-blob--cyan" />
        <span className="kivo-aurora-blob kivo-aurora-blob--violet" />
        <span className="kivo-aurora-blob kivo-aurora-blob--magenta" />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-6 py-5 lg:px-12">
        <div className="flex items-center gap-2">
          <KivoMarkGlyph size={32} />
          <span className="text-lg font-semibold tracking-tight text-foreground">KIVO</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/sign-in"
            className="flex min-h-10 items-center rounded-xl px-4 text-sm font-medium text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="kivo-gradient-prime flex min-h-10 items-center rounded-xl px-4 text-sm font-semibold text-on-accent kivo-glow kivo-raise focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            Sign up
          </Link>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        <section className="relative mx-auto flex w-full max-w-4xl flex-col items-center gap-8 overflow-hidden px-6 pb-16 pt-8 text-center lg:gap-9 lg:px-12 lg:pb-24 lg:pt-14">
          <style>{`
            @keyframes kivo-hero-logo-float {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-6px); }
            }
          `}</style>

          <div className="relative z-10 flex flex-col items-center gap-6 lg:gap-7">
            <FadeIn delay={0}>
              {/* Mark only — no wordmark, no tagline. The lockup's stacked text
                  repeats the wordmark already in the header and the headline
                  right below it, and it forced the K itself down to roughly
                  half the box. Cropping to the mark lets it run much larger at
                  the same footprint. Scales with the viewport rather than
                  jumping at one breakpoint. */}
              <div style={{ animation: "kivo-hero-logo-float 5s ease-in-out infinite" }}>
                <KivoMark
                  alt="KIVO"
                  priority
                  className="kivo-ink w-[13.5rem] sm:w-[17rem] lg:w-[21rem]"
                />
              </div>
            </FadeIn>

            <FadeIn delay={0.08}>
              <span className="rounded-full border border-hairline px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                Football. Together. Live.
              </span>
            </FadeIn>

            <FadeIn delay={0.16}>
              <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-foreground lg:text-6xl">
                The football home built for how fans actually watch, argue and play.
              </h1>
            </FadeIn>

            <FadeIn delay={0.24}>
              <p className="max-w-xl text-base text-foreground-muted lg:text-lg">
                Live scores and match intelligence, a social layer that feels alive during the game, an AI Copilot
                grounded in real data, and fantasy that&apos;s actually fun to build. All in one place.
              </p>
            </FadeIn>

            <FadeIn delay={0.32} className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/home"
                className="kivo-gradient-prime flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-on-accent kivo-glow kivo-raise focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                Explore KIVO
                <ArrowRight className="h-4 w-4" strokeWidth={2} />
              </Link>
              <Link
                href="/sign-up"
                className="kivo-glass-sharp kivo-raise flex items-center justify-center rounded-xl px-6 py-3 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                Create free account
              </Link>
            </FadeIn>

            <FadeIn delay={0.4}>
              <p className="text-xs text-foreground-subtle">
                No account needed to look around. Sign up only when you want to play.
              </p>
            </FadeIn>
          </div>

        </section>

        <section className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 px-6 pb-16 sm:grid-cols-2 lg:px-12">
          {PROOF_POINTS.map((point, index) => (
            <FeatureCard key={point.title} icon={point.icon} title={point.title} description={point.description} index={index} />
          ))}
        </section>

        <section className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-16 lg:px-12">
          <FadeIn className="flex flex-col items-center gap-3 text-center">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">How it works</span>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground lg:text-4xl">
              Look around free. Sign up when you&apos;re ready to play.
            </h2>
          </FadeIn>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {HOW_IT_WORKS.map((step, index) => (
              <FadeIn key={step.title} delay={index * 0.08} className="kivo-glass-brand flex flex-col gap-3 rounded-3xl p-6">
                <step.icon className="h-8 w-8 text-accent" strokeWidth={1.75} />
                <h3 className="text-base font-semibold text-foreground">{step.title}</h3>
                <p className="text-sm leading-relaxed text-foreground-muted">{step.description}</p>
              </FadeIn>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-hairline-soft px-6 py-12 lg:px-12">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
          <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
            <div className="flex max-w-xs flex-col gap-3">
              <div className="flex items-center gap-2">
                <KivoMarkGlyph size={28} />
                <span className="text-base font-semibold tracking-tight text-foreground">KIVO</span>
              </div>
              <p className="text-sm text-foreground-subtle">
                Football. Together. Live. Built for football lovers, starting in Nigeria.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-8 sm:flex sm:gap-16">
              {FOOTER_LINKS.map((group) => (
                <div key={group.heading} className="flex flex-col gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                    {group.heading}
                  </span>
                  <ul className="flex flex-col">
                    {group.links.map((link) => (
                      <li key={link.href}>
                        <Link
                          href={link.href}
                          className="flex min-h-10 items-center text-sm text-foreground-muted transition-colors hover:text-foreground"
                        >
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2 border-t border-hairline-soft pt-6 text-xs text-foreground-subtle sm:flex-row sm:items-center sm:justify-between">
            <span>© {new Date().getFullYear()} KIVO</span>
            <span>Real football data, real fans, no fabricated stats. Ever.</span>
          </div>
        </div>
      </footer>
      </div>
    </div>
  );
}
