import Link from "next/link";
import { Radio, Sparkles, Users, Trophy, ArrowRight } from "lucide-react";

const PROOF_POINTS = [
  {
    icon: Radio,
    title: "Live football, instantly",
    description: "Scores, events and match intelligence that update the moment they happen — no refresh, no lag.",
  },
  {
    icon: Sparkles,
    title: "AI Copilot, grounded",
    description:
      "Ask why a match turned, compare players, or get a fantasy pick — answered from KIVO's verified data, never guessed.",
  },
  {
    icon: Users,
    title: "Match Rooms, alive",
    description: "Every fixture has a home for fans — react to goals in real time, not a comment section bolted on.",
  },
  {
    icon: Trophy,
    title: "Fantasy & predictions",
    description: "Build your squad, back your instincts, climb the leaderboard — with your friends, not against a house.",
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
            className="kivo-gradient-prime rounded-xl px-4 py-2 text-sm font-semibold text-kivo-white transition-opacity hover:opacity-90"
          >
            Join KIVO
          </Link>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        <section className="mx-auto flex w-full max-w-4xl flex-col items-center gap-6 px-6 py-20 text-center lg:py-32">
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-kivo-cyan">
            Football. Together. Live.
          </span>
          <h1 className="text-4xl font-semibold tracking-tight text-foreground lg:text-6xl">
            The football home built for how fans actually watch, argue and play.
          </h1>
          <p className="max-w-2xl text-base text-foreground-muted lg:text-lg">
            Live scores and match intelligence, a social layer that feels alive during the game, an AI Copilot grounded
            in real data, and fantasy that&apos;s actually fun to build — all in one place.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/sign-up"
              className="kivo-gradient-prime flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-kivo-white transition-opacity hover:opacity-90"
            >
              Get started
              <ArrowRight className="h-4 w-4" strokeWidth={2} />
            </Link>
            <Link
              href="/sign-in"
              className="kivo-glass flex items-center justify-center rounded-xl px-6 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-white/[0.07]"
            >
              Sign in
            </Link>
          </div>
        </section>

        <section className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 px-6 pb-24 sm:grid-cols-2 lg:px-12">
          {PROOF_POINTS.map((point) => (
            <div key={point.title} className="kivo-glass flex flex-col gap-3 rounded-2xl p-6">
              <div className="kivo-gradient-intelligence flex h-10 w-10 items-center justify-center rounded-xl">
                <point.icon className="h-5 w-5 text-kivo-white" strokeWidth={1.75} />
              </div>
              <h3 className="text-base font-semibold text-foreground">{point.title}</h3>
              <p className="text-sm leading-relaxed text-foreground-muted">{point.description}</p>
            </div>
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
