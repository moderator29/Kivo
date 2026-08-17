import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ShieldCheck, UserPlus, Sparkles } from "lucide-react";
import kivoHeroArtwork from "../../public/brand/kivo-artwork-hero.webp";
import { FadeIn } from "@/components/ui/fade-in";
import { FeatureCard } from "@/components/marketing/feature-card";
import { KivoMarkGlyph } from "@/components/ui/kivo-mark-glyph";
import { ScatteredTrophies } from "@/components/marketing/scattered-trophies";

// This page used to be `"use client"` in full just so two elements could
// float via `motion.div` — that shipped React, `motion` and the whole page
// tree as client JS on the highest-traffic, most bounce-sensitive route.
// Every float below is a pure CSS keyframe (see the inline `<style>` in the
// hero section), same pattern as the aurora background and `KivoMarkGlyph`,
// so this stays a Server Component. See RECOMMENDATIONS.md item 73.
//
// Hero visual, revised twice now:
// 1. The original hero used `kivo-trophy-crown.webp` at large, fully legible
//    size. Re-examined at that size (not the tiny/near-illegible scale
//    ScatteredTrophies below uses it at) it bakes in real competition marks
//    — a Champions League star-ball, and the Premier League, LaLiga, Serie
//    A, Bundesliga and Ligue 1 crests — into one flattened promotional
//    composite, plus silhouetted athlete figures. That's real trademark
//    exposure for a live commercial product, so it was pulled from the hero
//    (kept only at ScatteredTrophies' tiny, illegible decorative scale).
// 2. That was temporarily replaced with a hero built entirely from KIVO's
//    own real UI language (glass cards + feature icons). Now replaced again
//    with `kivo-artwork-hero.webp`, one of four commissioned KIVO artwork
//    pieces (checked individually for the same trademark/right-of-publicity
//    issue as #1 before use): a stylised K-emblem, crown, globe and stadium
//    render with the KIVO wordmark. Verified clean — no real club/league
//    crests, no readable third-party marks, no identifiable real athletes
//    (every figure is an anonymous silhouette). The other three pieces
//    (`kivo-artwork-command`, `-action`, `-social`) are saved alongside it
//    for use elsewhere in the product (dashboard, match centre, community,
//    empty states) rather than left unused.

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

      <ScatteredTrophies />

      <div className="relative z-10 flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-6 py-5 lg:px-12">
        <div className="flex items-center gap-2">
          <KivoMarkGlyph size={32} />
          <span className="text-lg font-semibold tracking-tight text-foreground">KIVO</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/sign-in"
            className="flex min-h-10 items-center rounded-xl px-4 text-sm font-medium text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="kivo-gradient-prime flex min-h-10 items-center rounded-xl px-4 text-sm font-semibold text-kivo-white shadow-[0_0_0_1px_rgba(0,217,255,0.4)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
          >
            Sign up
          </Link>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        <section className="relative mx-auto flex w-full max-w-6xl flex-col items-center gap-10 overflow-hidden px-6 pb-16 pt-6 text-center lg:flex-row lg:items-center lg:gap-8 lg:px-12 lg:pb-24 lg:pt-10 lg:text-left">
          <style>{`
            @keyframes kivo-hero-artwork-float {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-10px); }
            }
          `}</style>

          <div className="relative z-10 order-2 flex flex-col items-center gap-6 lg:order-1 lg:items-start lg:gap-7">
            {/* No standalone logo mark here on purpose: the hero artwork
                already carries a KIVO wordmark within its own composition,
                and the header (always visible, see the top nav above) has
                the brand glyph — a third repetition right above the tagline
                was pure redundancy competing with the artwork for attention. */}
            <FadeIn delay={0.08}>
              <span className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-kivo-cyan">
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
                className="kivo-gradient-prime flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-kivo-white shadow-[0_0_0_1px_rgba(0,217,255,0.4),0_8px_30px_-8px_rgba(37,99,255,0.6)] transition duration-150 hover:scale-[1.03] hover:opacity-90 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
              >
                Explore KIVO
                <ArrowRight className="h-4 w-4" strokeWidth={2} />
              </Link>
              <Link
                href="/sign-up"
                className="kivo-glass-sharp flex items-center justify-center rounded-xl px-6 py-3 text-sm font-semibold text-foreground transition-all duration-150 hover:scale-[1.03] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
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

          {/* Hero visual: commissioned KIVO artwork (see the import-site comment
              above for the trademark check this went through). Shown on every
              breakpoint, not just desktop, since a single scaling image (unlike
              the old four-card cluster it replaced) has a clean mobile layout.
              Ordered *before* the text column on mobile (order-1 vs. the text
              column's order-2) so it's the first thing a visitor sees without
              scrolling — a striking commissioned visual buried below the fold
              undersells itself. Desktop keeps its original side-by-side
              placement (order-2, right of the text) via the lg: overrides.
              The image's own soft glow bleeds slightly non-black at its top/
              bottom edges (checked in production), so it's edge-masked here to
              dissolve into the page background instead of showing a rectangle. */}
          <div className="relative z-10 order-1 flex w-full max-w-sm flex-1 items-center justify-center lg:order-2 lg:h-[460px] lg:max-w-none">
            <div
              style={{
                animation: "kivo-hero-artwork-float 7s ease-in-out infinite",
                maskImage: "radial-gradient(closest-side, black 72%, transparent 100%)",
                WebkitMaskImage: "radial-gradient(closest-side, black 72%, transparent 100%)",
              }}
            >
              <Image
                src={kivoHeroArtwork}
                alt="KIVO: live scores, AI-grounded analysis, and a social layer for football fans, all in one app"
                width={1536}
                height={1024}
                className="h-auto w-full object-contain lg:h-[460px] lg:w-auto"
                sizes="(min-width: 1024px) 640px, 90vw"
                priority
              />
            </div>
          </div>
        </section>

        <section className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 px-6 pb-16 sm:grid-cols-2 lg:px-12">
          {PROOF_POINTS.map((point, index) => (
            <FeatureCard key={point.title} icon={point.icon} title={point.title} description={point.description} index={index} />
          ))}
        </section>

        <section className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-16 lg:px-12">
          <FadeIn className="flex flex-col items-center gap-3 text-center">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-kivo-cyan">How it works</span>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground lg:text-4xl">
              Look around free. Sign up when you&apos;re ready to play.
            </h2>
          </FadeIn>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {HOW_IT_WORKS.map((step, index) => (
              <FadeIn key={step.title} delay={index * 0.08} className="kivo-glass-brand flex flex-col gap-3 rounded-3xl p-6">
                <step.icon className="h-8 w-8 text-kivo-cyan" strokeWidth={1.75} />
                <h3 className="text-base font-semibold text-foreground">{step.title}</h3>
                <p className="text-sm leading-relaxed text-foreground-muted">{step.description}</p>
              </FadeIn>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-white/5 px-6 py-12 lg:px-12">
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
          <div className="flex flex-col gap-2 border-t border-white/5 pt-6 text-xs text-foreground-subtle sm:flex-row sm:items-center sm:justify-between">
            <span>© {new Date().getFullYear()} KIVO</span>
            <span>Real football data, real fans, no fabricated stats. Ever.</span>
          </div>
        </div>
      </footer>
      </div>
    </div>
  );
}
