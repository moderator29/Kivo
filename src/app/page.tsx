"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import kivoLogo from "../../public/brand/kivo-logo.png";
import kivoTrophyCrown from "../../public/brand/kivo-trophy-crown.webp";
import { FadeIn } from "@/components/ui/fade-in";
import { FeatureCard } from "@/components/marketing/feature-card";
import { KivoMarkGlyph } from "@/components/ui/kivo-mark-glyph";
import { ScatteredTrophies } from "@/components/marketing/scattered-trophies";

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

export default function LandingPage() {
  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      <div className="kivo-aurora-page" aria-hidden="true">
        <span className="kivo-aurora-blob kivo-aurora-blob--cyan" />
        <span className="kivo-aurora-blob kivo-aurora-blob--violet" />
        <span className="kivo-aurora-blob kivo-aurora-blob--magenta" />
      </div>

      <ScatteredTrophies />

      <div className="relative z-10 flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-6 py-5 lg:px-12">
        <div className="flex items-center gap-2">
          <span className="kivo-gradient-prime h-8 w-8 rounded-lg" aria-hidden />
          <span className="text-lg font-semibold tracking-tight text-foreground">KIVO</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/sign-in"
            className="rounded-xl px-4 py-2 text-sm font-medium text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="kivo-gradient-prime rounded-xl px-4 py-2 text-sm font-semibold text-kivo-white shadow-[0_0_0_1px_rgba(0,217,255,0.4)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
          >
            Sign up
          </Link>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        <section className="relative mx-auto flex w-full max-w-4xl flex-col items-center gap-6 overflow-hidden px-6 py-20 text-center lg:py-32">
          {/* The page-wide aurora above already covers this section. This is
              the hero's real visual anchor: big, genuinely visible (not a
              faint hint), fading into the page at its edges so it reads as
              part of the background rather than a pasted-on rectangle. */}
          <motion.div
            initial={{ opacity: 0, y: 0 }}
            animate={{ opacity: 1, y: [0, -10, 0] }}
            transition={{ opacity: { duration: 1 }, y: { duration: 8, repeat: Infinity, ease: "easeInOut" } }}
            className="pointer-events-none absolute -right-16 -top-10 h-[480px] w-[340px] sm:-right-8 sm:h-[600px] sm:w-[420px] lg:right-0 lg:h-[720px] lg:w-[500px]"
            style={{
              maskImage: "radial-gradient(ellipse 85% 75% at 60% 35%, black 45%, transparent 85%)",
              WebkitMaskImage: "radial-gradient(ellipse 85% 75% at 60% 35%, black 45%, transparent 85%)",
            }}
            aria-hidden="true"
          >
            <Image src={kivoTrophyCrown} alt="" fill sizes="500px" className="object-contain object-top opacity-45" priority />
          </motion.div>

          <KivoMarkGlyph
            size={360}
            opacity={0.08}
            className="absolute -left-20 -top-16 lg:-left-8"
          />

          <div className="relative z-10 flex flex-col items-center gap-6">
            <FadeIn delay={0}>
              <motion.div
                initial={{ y: 0 }}
                animate={{ y: [0, -6, 0] }}
                transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
              >
                <Image
                  src={kivoLogo}
                  alt=""
                  width={200}
                  height={200}
                  className="h-36 w-36 lg:h-48 lg:w-48"
                  sizes="(min-width: 1024px) 204px, 153px"
                  priority
                />
              </motion.div>
            </FadeIn>

            <FadeIn delay={0.08}>
              <span className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-kivo-cyan">
                Football. Together. Live.
              </span>
            </FadeIn>

            <FadeIn delay={0.16}>
              <h1 className="text-4xl font-semibold tracking-tight text-foreground lg:text-6xl">
                The football home built for how fans actually watch, argue and play.
              </h1>
            </FadeIn>

            <FadeIn delay={0.24}>
              <p className="max-w-2xl text-base text-foreground-muted lg:text-lg">
                Live scores and match intelligence, a social layer that feels alive during the game, an AI Copilot
                grounded in real data, and fantasy that&apos;s actually fun to build. All in one place.
              </p>
            </FadeIn>

            <FadeIn delay={0.32} className="flex flex-col gap-3 sm:flex-row">
              <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                <Link
                  href="/home"
                  className="kivo-gradient-prime flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-kivo-white shadow-[0_0_0_1px_rgba(0,217,255,0.4),0_8px_30px_-8px_rgba(37,99,255,0.6)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
                >
                  Get started
                  <ArrowRight className="h-4 w-4" strokeWidth={2} />
                </Link>
              </motion.div>
              <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                <Link
                  href="/sign-in"
                  className="kivo-glass-sharp flex items-center justify-center rounded-xl px-6 py-3 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
                >
                  Sign in
                </Link>
              </motion.div>
            </FadeIn>
          </div>
        </section>

        <section className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 px-6 pb-24 sm:grid-cols-2 lg:px-12">
          {PROOF_POINTS.map((point, index) => (
            <FeatureCard key={point.title} icon={point.icon} title={point.title} description={point.description} index={index} />
          ))}
        </section>
      </main>

      <footer className="flex items-center justify-between border-t border-white/5 px-6 py-6 text-xs text-foreground-subtle lg:px-12">
        <span>© {new Date().getFullYear()} KIVO</span>
        <span>Built for football lovers, starting in Nigeria.</span>
      </footer>
      </div>
    </div>
  );
}
