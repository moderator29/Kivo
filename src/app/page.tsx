import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import kivoLogo from "../../public/brand/kivo-logo.png";
import { FadeIn } from "@/components/ui/fade-in";
import { FeatureCard } from "@/components/marketing/feature-card";

const PROOF_POINTS = [
  {
    icon: "/assets/icons/navigation/live-scores.webp",
    title: "Live football, instantly",
    description: "Scores, events and match intelligence that update the moment they happen. No refresh, no lag.",
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
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-5 lg:px-12">
        <div className="flex items-center gap-2">
          <span className="kivo-gradient-prime h-8 w-8 rounded-lg" aria-hidden />
          <span className="text-lg font-semibold tracking-tight text-foreground">KIVO</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/sign-in"
            className="rounded-xl px-4 py-2 text-sm font-medium text-foreground-muted transition-colors hover:text-foreground"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="kivo-gradient-prime rounded-xl px-4 py-2 text-sm font-semibold text-kivo-white shadow-[0_0_0_1px_rgba(0,217,255,0.4)] transition-opacity hover:opacity-90"
          >
            Join KIVO
          </Link>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        <section className="mx-auto flex w-full max-w-4xl flex-col items-center gap-6 px-6 py-20 text-center lg:py-32">
          <FadeIn className="flex flex-col items-center gap-6">
            <Image src={kivoLogo} alt="" width={144} height={144} className="h-28 w-28 lg:h-36 lg:w-36" priority />
            <span className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-kivo-cyan">
              Football. Together. Live.
            </span>
            <h1 className="text-4xl font-semibold tracking-tight text-foreground lg:text-6xl">
              The football home built for how fans actually watch, argue and play.
            </h1>
            <p className="max-w-2xl text-base text-foreground-muted lg:text-lg">
              Live scores and match intelligence, a social layer that feels alive during the game, an AI Copilot
              grounded in real data, and fantasy that&apos;s actually fun to build. All in one place.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/sign-up"
                className="kivo-gradient-prime flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-kivo-white shadow-[0_0_0_1px_rgba(0,217,255,0.4),0_8px_30px_-8px_rgba(37,99,255,0.6)] transition-opacity hover:opacity-90"
              >
                Get started
                <ArrowRight className="h-4 w-4" strokeWidth={2} />
              </Link>
              <Link
                href="/sign-in"
                className="kivo-glass-sharp flex items-center justify-center rounded-xl px-6 py-3 text-sm font-semibold text-foreground"
              >
                Sign in
              </Link>
            </div>
          </FadeIn>
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
  );
}
