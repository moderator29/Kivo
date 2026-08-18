import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Check, Eye, MessagesSquare, ShieldCheck, UserPlus, Sparkles } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { KivoMark } from "@/components/ui/kivo-mark";
import { FeatureCard } from "@/components/marketing/feature-card";
import { KivoMarkGlyph } from "@/components/ui/kivo-mark-glyph";
import { FaqSection } from "@/components/marketing/faq-section";
import { InsidePreview } from "@/components/marketing/inside-preview";

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

// Decorative marquee (see .kivo-ticker in globals.css): every line restates
// a fact stated in full elsewhere on this page (proof points, feature
// showcase, /transparency itself) — nothing here is the sole source of a
// claim, which is also why the strip that renders this is aria-hidden.
// "Real-time" is deliberately scoped to "once synced" rather than implying
// 24/7 live polling: FOOTBALL_LIVE_POLLING_ENABLED (src/lib/football/index.ts)
// is off until a paid provider tier exists, so today a sync is admin- or
// user-triggered, not continuous — but Supabase Realtime genuinely does fan
// out every update the instant a sync writes it, to every subscribed client,
// with no page refresh (src/hooks/use-realtime-fixtures.ts, migration
// 0038_realtime_fixture_distribution; the same pattern powers Social's live
// "new posts" banner via migration 0042_realtime_posts).
const TICKER_ITEMS = [
  "Real-time score updates the instant a fixture syncs",
  "Match Rooms scoped to real fixtures",
  "AI Copilot grounded in synced data, never guessed",
  "Predictions scored from real match results",
  "Fantasy points computed from real match events",
  "Zero fabricated stats, ever",
];

// Deeper pass over the same ground PROOF_POINTS covers above, one section
// per real feature area rather than one line each. Descriptions and bullets
// are checked against the actual feature code, not the marketing pitch:
// - Match Centre: src/components/matches/match-centre-tabs.tsx (events,
//   lineups/formations), lineup-pitch.tsx, heatmap-view.tsx, fan-rating-card.tsx,
//   match-room.tsx.
// - AI Copilot: src/app/(app)/ai/page.tsx + src/lib/ai/grounding.ts (grounding
//   context, the "What KIVO knows right now" disclosure panel) and
//   src/components/ai/ask-ai-link.tsx (fixture/team/player deep links).
// - Social / Match Rooms: src/app/(app)/social/page.tsx, social-feed.tsx's
//   Realtime "new posts" banner, match-room.tsx (fixture-scoped posts).
// - Fantasy: src/app/(app)/fantasy/fantasy-builder.tsx, fantasy-rules.ts,
//   fantasy-leaderboard.tsx, deadline-countdown.tsx.
// - Predictions: src/app/(app)/predictions/page.tsx (get_prediction_consensus,
//   get_predictions_leaderboard RPCs).
const FEATURE_SHOWCASE: {
  icon: string;
  title: string;
  description: string;
  bullets: string[];
  href: string;
  cta: string;
}[] = [
  {
    icon: "/assets/icons/navigation/matches.webp",
    title: "Match Centre",
    description:
      "Every fixture gets its own command centre: live match events as they're synced, starting lineups with real formations, full team stats, shot maps and heatmaps, fan ratings, and a Match Room where supporters talk through the game.",
    bullets: ["Lineups & real formations", "Live match events", "Team stats & heatmaps", "Fan ratings"],
    href: "/matches",
    cta: "Open Match Centre",
  },
  {
    icon: "/assets/icons/navigation/ai-copilot.webp",
    title: "AI Copilot",
    description:
      "Ask why a match turned, compare two players, or get a fantasy pick — every answer is built from KIVO's own synced data. A disclosure panel shows exactly what it knew when it answered, and it says so plainly when the data isn't there yet.",
    bullets: [
      "Grounded in real synced data",
      "“What KIVO knows right now” disclosure",
      "Deep-links from any fixture, team or player",
      "Full conversation history",
    ],
    href: "/ai",
    cta: "Ask the Copilot",
  },
  {
    icon: "/assets/icons/social/chat-social.webp",
    title: "Social & Match Rooms",
    description:
      "A community feed for the wider conversation, plus a Match Room on every fixture — reactions, comments and posts scoped to that game. A live “new posts” banner, powered by Supabase Realtime, means the room never goes stale mid-scroll.",
    bullets: ["A Match Room on every fixture", "Reactions & comment threads", "Live “new posts” banner", "A following-only feed filter"],
    href: "/social",
    cta: "See the community",
  },
  {
    icon: "/assets/icons/fantasy-rewards/fantasy.webp",
    title: "Fantasy",
    description:
      "Build a squad from real players at real prices, under scoring rules that are actually published, not a black box. Points come from the match events KIVO synced. Join or create a league and track the table against friends.",
    bullets: ["Squad builder & transfers", "Scoring from real match events", "Leagues & leaderboards", "Deadline countdown per gameweek"],
    href: "/fantasy",
    cta: "Build a squad",
  },
  {
    icon: "/assets/icons/navigation/predictions.webp",
    title: "Predictions",
    description:
      "Pick the outcome of any upcoming fixture before kickoff, see what the rest of KIVO is picking, and climb a points leaderboard once matches are scored. No house, just fans against the form guide.",
    bullets: ["Pick before kickoff", "See the fan consensus", "A scored leaderboard", "Your prediction history"],
    href: "/predictions",
    cta: "Make a prediction",
  },
];

// The platform's real, checkable differentiators — not aspirational claims.
// Each links to the actual page that backs it up.
const WHY_KIVO = [
  {
    icon: ShieldCheck,
    title: "Zero fabricated data",
    description:
      "Every score, stat, lineup and table on KIVO is synced from real football data — never invented, never guessed. The transparency page shows exactly what's synced right now, down to the row count.",
    href: "/transparency",
    cta: "See what's synced",
  },
  {
    icon: Sparkles,
    title: "AI grounded in what's real",
    description:
      "The AI Copilot only states facts it can verify from KIVO's own synced data, and a disclosure panel shows exactly what it knew when it answered — never a guess dressed up as fact.",
    href: "/ai",
    cta: "Try the Copilot",
  },
  {
    icon: MessagesSquare,
    title: "A social layer tied to real fixtures",
    description:
      "Every Match Room is scoped to one real fixture, not a generic chatroom. Reactions and conversation happen against the actual game, with new posts arriving live.",
    href: "/social",
    cta: "See a Match Room",
  },
  {
    icon: Eye,
    title: "Honest when data isn't there",
    description:
      "No data yet doesn't get a fabricated placeholder. If a leaderboard hasn't scored or a fixture hasn't synced, KIVO says so plainly instead of faking a number.",
    href: "/transparency",
    cta: "Read the freshness log",
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

/** A landing-page link to something that lives behind the door. Sends the
 * visitor to sign-in with the real destination attached, so the auth flow lands
 * them on what they clicked rather than dumping everyone on /home (KN-38, using
 * the redirect KN-123 built). */
function signInTo(path: string): string {
  return `/sign-in?redirect_url=${encodeURIComponent(path)}`;
}

const FOOTER_LINKS: { heading: string; note?: string; links: { label: string; href: string }[] }[] = [
  {
    // KN-38: every one of these used to point straight into the gated app, so
    // each was a link that silently became a login form. They now go through
    // /sign-in carrying their real destination — which the auth flow honours
    // (KN-123), so signing in lands on the thing that was clicked — and the
    // heading says what to expect before the click rather than after it.
    heading: "Inside KIVO",
    note: "Account required",
    links: [
      { label: "Live scores", href: signInTo("/live") },
      { label: "Match Centre", href: signInTo("/matches") },
      { label: "Fantasy", href: signInTo("/fantasy") },
      { label: "Predictions", href: signInTo("/predictions") },
      { label: "AI Copilot", href: signInTo("/ai") },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Transparency", href: signInTo("/transparency") },
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
        <span className="kivo-aurora-blob kivo-aurora-blob--cyan-soft" />
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
                <KivoMark alt="KIVO" priority className="kivo-ink w-[13.5rem] sm:w-[17rem] lg:w-[21rem]" />
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

            {/* KN-38: "Explore KIVO" pointed at /home, which is behind the
                door — the button that led the whole page bounced every visitor
                into a sign-in form. A CTA that cannot do what it says is the
                fastest way to make a gate feel like a bug. */}
            <FadeIn delay={0.32} className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/sign-up"
                className="kivo-gradient-prime flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-on-accent kivo-glow kivo-raise focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                Create your free account
                <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
              </Link>
              <Link
                href="/sign-in"
                className="kivo-glass-sharp kivo-raise flex items-center justify-center rounded-xl px-6 py-3 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                I already have one
              </Link>
            </FadeIn>

            {/* The line this replaces said "No account needed to look around.
                Sign up only when you want to play." That stopped being true the
                day the app was gated, and it was the first thing a visitor read
                before being sent to a login form. This says the true thing, and
                says *why* — an account is not a toll, it is what makes the
                product work at all. */}
            <FadeIn delay={0.4}>
              <p className="max-w-md text-xs leading-relaxed text-foreground-subtle">
                KIVO needs an account because there is no version of it that isn&apos;t yours: your clubs decide what
                leads your home screen, your predictions and squad are the point, and Match Rooms are people, not
                readers. It takes an email address and a six-digit code — no password to forget.
              </p>
            </FadeIn>
          </div>
        </section>

        {/* Decorative marquee restating real, already-stated-elsewhere facts
            (see TICKER_ITEMS above for exactly why each line is true and
            where it's stated in full) — ambient texture, not a new claim, so
            it's aria-hidden and the list is duplicated once for a seamless
            CSS loop (.kivo-ticker-track in globals.css). */}
        <div className="kivo-ticker border-y border-hairline-soft py-3" aria-hidden="true">
          <div className="kivo-ticker-track">
            {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, index) => (
              <span key={index} className="flex shrink-0 items-center gap-2 px-6 text-xs font-medium text-foreground-subtle">
                <span className="h-1 w-1 shrink-0 rounded-full bg-accent/70" />
                {item}
              </span>
            ))}
          </div>
        </div>

        {/* KN-38: with the app gated, the landing page can no longer say "look
            around" — so it has to show. This is the only place on the page that
            shows the product's own interface rather than describing it, and it
            shows the layout with its content slots labelled rather than filled
            with invented football. See InsidePreview's own doc comment for why
            a plausible-looking example scoreline would still be fabricated
            data. */}
        <section className="mx-auto flex w-full max-w-5xl flex-col items-center gap-10 px-6 py-16 lg:flex-row lg:items-center lg:gap-16 lg:px-12">
          <ScrollReveal className="flex flex-1 flex-col gap-4">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">A look inside</span>
            <h2 className="max-w-md text-3xl font-semibold tracking-tight text-foreground lg:text-4xl">
              The first screen is built around your clubs.
            </h2>
            <p className="max-w-md text-sm leading-relaxed text-foreground-muted lg:text-base">
              KIVO opens on whatever is actually true for you right now, in priority order — a club you follow playing
              live, then the next kick-off, then a fantasy deadline, then the calls you haven&apos;t made. Every card
              tells you why it&apos;s there.
            </p>
            <p className="max-w-md text-sm leading-relaxed text-foreground-muted lg:text-base">
              That is also why there is a door: none of it works without knowing whose football this is.
            </p>
          </ScrollReveal>
          <ScrollReveal delay={0.08} className="flex w-full flex-1 justify-center">
            <InsidePreview />
          </ScrollReveal>
        </section>

        <section className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 px-6 py-16 sm:grid-cols-2 lg:px-12">
          {PROOF_POINTS.map((point, index) => (
            <FeatureCard key={point.title} icon={point.icon} title={point.title} description={point.description} index={index} />
          ))}
        </section>

        <section className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-16 lg:px-12">
          <ScrollReveal className="flex flex-col items-center gap-3 text-center">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">What&apos;s inside</span>
            <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-foreground lg:text-4xl">
              Everything a matchday needs, actually built out
            </h2>
            <p className="max-w-xl text-sm text-foreground-muted lg:text-base">
              Not a roadmap. Five features, each already live, each grounded in real data.
            </p>
          </ScrollReveal>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURE_SHOWCASE.map((feature, index) => (
              <ScrollReveal
                key={feature.title}
                delay={(index % 3) * 0.08}
                className="kivo-glass-brand flex flex-col gap-5 rounded-3xl p-7"
              >
                <div className="flex items-center gap-4">
                  <Image src={feature.icon} alt="" width={48} height={48} className="h-12 w-12 shrink-0 object-contain" />
                  <h3 className="text-lg font-semibold text-foreground">{feature.title}</h3>
                </div>
                <p className="text-sm leading-relaxed text-foreground-muted">{feature.description}</p>
                <ul className="flex flex-1 flex-col gap-2 border-t border-hairline-soft pt-4">
                  {feature.bullets.map((bullet) => (
                    <li key={bullet} className="flex items-start gap-2 text-xs text-foreground-subtle">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                      {bullet}
                    </li>
                  ))}
                </ul>
                <Link
                  href={feature.href}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent transition-colors hover:text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  {feature.cta}
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
                </Link>
              </ScrollReveal>
            ))}
          </div>
        </section>

        <section className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-16 lg:px-12">
          <ScrollReveal className="flex flex-col items-center gap-3 text-center">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Why KIVO</span>
            <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-foreground lg:text-4xl">
              Built different, on purpose
            </h2>
            <p className="max-w-xl text-sm text-foreground-muted lg:text-base">
              Four things that are actually true about KIVO, not just claimed. Check any of them yourself.
            </p>
          </ScrollReveal>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {WHY_KIVO.map((pillar, index) => (
              <ScrollReveal key={pillar.title} delay={(index % 2) * 0.08} className="kivo-glass flex flex-col gap-4 rounded-3xl p-7">
                <div className="kivo-glass-sharp flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
                  <pillar.icon className="h-5 w-5 text-accent" strokeWidth={1.75} />
                </div>
                <h3 className="text-base font-semibold text-foreground">{pillar.title}</h3>
                <p className="text-sm leading-relaxed text-foreground-muted">{pillar.description}</p>
                <Link
                  href={pillar.href}
                  className="mt-auto inline-flex items-center gap-1.5 text-xs font-semibold text-accent transition-colors hover:text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  {pillar.cta}
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
                </Link>
              </ScrollReveal>
            ))}
          </div>
        </section>

        <section className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-16 lg:px-12">
          <ScrollReveal className="flex flex-col items-center gap-3 text-center">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">How it works</span>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground lg:text-4xl">
              Look around free. Sign up when you&apos;re ready to play.
            </h2>
          </ScrollReveal>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {HOW_IT_WORKS.map((step, index) => (
              <ScrollReveal key={step.title} delay={index * 0.08} className="kivo-glass-brand flex flex-col gap-3 rounded-3xl p-6">
                <step.icon className="h-8 w-8 text-accent" strokeWidth={1.5} />
                <h3 className="text-base font-semibold text-foreground">{step.title}</h3>
                <p className="text-sm leading-relaxed text-foreground-muted">{step.description}</p>
              </ScrollReveal>
            ))}
          </div>
        </section>

        <section className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-16 lg:px-12">
          <ScrollReveal className="flex flex-col items-center gap-3 text-center">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">FAQ</span>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground lg:text-4xl">
              Real questions, real answers
            </h2>
            <p className="max-w-xl text-sm text-foreground-muted lg:text-base">
              No hype, just what KIVO actually is and how it actually works.
            </p>
          </ScrollReveal>
          <ScrollReveal delay={0.08}>
            <FaqSection />
          </ScrollReveal>
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
                  <span className="flex flex-col gap-0.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                      {group.heading}
                    </span>
                    {group.note && <span className="text-[10px] text-foreground-subtle/70">{group.note}</span>}
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
            <Link
              href={signInTo("/transparency")}
              className="inline-flex items-center gap-1.5 transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              Real football data, real fans, no fabricated stats. Ever. See what&apos;s synced
              <ArrowRight className="h-3 w-3" strokeWidth={2} />
            </Link>
          </div>
        </div>
      </footer>
      </div>
    </div>
  );
}
