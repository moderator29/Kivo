import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ShieldCheck, UserPlus, Sparkles } from "lucide-react";
import kivoLogo from "../../public/brand/kivo-logo-transparent.webp";
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
// Hero visual, revised: the previous hero used `kivo-trophy-crown.webp` at
// large, fully legible size. Re-examined at that size (not the tiny/near-
// illegible scale ScatteredTrophies below uses it at) it bakes in real
// competition marks — a Champions League star-ball, and the Premier League,
// LaLiga, Serie A, Bundesliga and Ligue 1 crests — into one flattened
// promotional composite, plus silhouetted athlete figures. That is real
// trademark/right-of-publicity exposure for a live commercial product, the
// same category of problem as the separate real-player-photo composite the
// founder asked for and was declined, just a smaller version of it. The
// hero visual below is built entirely from KIVO's own real UI language
// instead (the actual glass-card system, the actual feature icons already
// shipped in the product) — legally clean, and arguably more honest: it
// previews what the product actually looks like rather than stock-style
// imagery standing in for it.

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
            @keyframes kivo-hero-logo-float {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-6px); }
            }
            @keyframes kivo-hero-orb-pulse {
              0%, 100% { opacity: 0.55; transform: scale(1); }
              50% { opacity: 0.85; transform: scale(1.06); }
            }
            @keyframes kivo-hero-card-float-a {
              0%, 100% { transform: translateY(0) rotate(-4deg); }
              50% { transform: translateY(-14px) rotate(-4deg); }
            }
            @keyframes kivo-hero-card-float-b {
              0%, 100% { transform: translateY(0) rotate(3deg); }
              50% { transform: translateY(-10px) rotate(3deg); }
            }
            @keyframes kivo-hero-card-float-c {
              0%, 100% { transform: translateY(0) rotate(-2deg); }
              50% { transform: translateY(-12px) rotate(-2deg); }
            }
            @keyframes kivo-hero-card-float-d {
              0%, 100% { transform: translateY(0) rotate(5deg); }
              50% { transform: translateY(-8px) rotate(5deg); }
            }
          `}</style>

          <div className="relative z-10 flex flex-col items-center gap-6 lg:items-start lg:gap-7">
            <FadeIn delay={0}>
              <div style={{ animation: "kivo-hero-logo-float 5s ease-in-out infinite" }}>
                <Image
                  src={kivoLogo}
                  alt="KIVO"
                  width={280}
                  height={280}
                  className="h-44 w-44 lg:h-56 lg:w-56"
                  sizes="(min-width: 1024px) 224px, 176px"
                  priority
                />
              </div>
            </FadeIn>

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

          {/* Hero visual: KIVO's own real feature surfaces, not a stand-in image.
              Hidden below lg — four absolutely-positioned floating cards around a
              centered text column has no clean mobile layout, so this whole
              cluster simply doesn't render there rather than being crushed into
              something unreadable. */}
          <div
            className="relative z-10 hidden h-[420px] w-full flex-1 items-center justify-center lg:flex"
            aria-hidden="true"
          >
            <div
              className="absolute h-[360px] w-[360px] rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgba(0,217,255,0.35) 0%, rgba(124,63,255,0.25) 45%, transparent 75%)",
                filter: "blur(40px)",
                animation: "kivo-hero-orb-pulse 6s ease-in-out infinite",
              }}
            />

            <div
              className="kivo-glass-brand absolute left-2 top-4 flex w-48 flex-col gap-2 rounded-2xl p-4"
              style={{ animation: "kivo-hero-card-float-a 7s ease-in-out infinite" }}
            >
              <Image src={PROOF_POINTS[0].icon} alt="" width={32} height={32} className="h-8 w-8" />
              <p className="text-xs font-semibold text-foreground">{PROOF_POINTS[0].title}</p>
            </div>

            <div
              className="kivo-glass-brand absolute right-4 top-0 flex w-52 flex-col gap-2 rounded-2xl p-4"
              style={{ animation: "kivo-hero-card-float-b 8s ease-in-out infinite", animationDelay: "0.4s" }}
            >
              <Image src={PROOF_POINTS[1].icon} alt="" width={32} height={32} className="h-8 w-8" />
              <p className="text-xs font-semibold text-foreground">{PROOF_POINTS[1].title}</p>
            </div>

            <div
              className="kivo-glass-brand absolute bottom-6 left-8 flex w-52 flex-col gap-2 rounded-2xl p-4"
              style={{ animation: "kivo-hero-card-float-c 7.5s ease-in-out infinite", animationDelay: "0.8s" }}
            >
              <Image src={PROOF_POINTS[2].icon} alt="" width={32} height={32} className="h-8 w-8" />
              <p className="text-xs font-semibold text-foreground">{PROOF_POINTS[2].title}</p>
            </div>

            <div
              className="kivo-glass-brand absolute bottom-0 right-2 flex w-48 flex-col gap-2 rounded-2xl p-4"
              style={{ animation: "kivo-hero-card-float-d 6.5s ease-in-out infinite", animationDelay: "0.2s" }}
            >
              <Image src={PROOF_POINTS[3].icon} alt="" width={32} height={32} className="h-8 w-8" />
              <p className="text-xs font-semibold text-foreground">{PROOF_POINTS[3].title}</p>
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
              <FadeIn key={step.title} delay={index * 0.08} className="kivo-glass-brand flex flex-col gap-3 rounded-2xl p-6">
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
