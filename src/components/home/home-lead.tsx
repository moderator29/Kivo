import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, CalendarClock, Radio, Star, Target, Trophy } from "lucide-react";
import type { HomeLead } from "@/lib/home-lead";
import type { LeadFixture } from "@/lib/home-lead";
import { TeamCrest } from "@/components/ui/team-crest";
import { LocalDateTime } from "@/components/ui/relative-time";
import { LeadCountdown } from "@/components/home/lead-countdown";

/**
 * /home's lead slot — the one card on the page that is allowed to shout
 * (KN-37). What it shows is decided entirely by `selectHomeLead`
 * (src/lib/home-lead.ts); this component only renders the decision, which is
 * why the ladder is unit-testable and this file has no branching logic of its
 * own beyond one `switch`.
 *
 * Design intent, in the founder's terms: restrained everywhere else, energy
 * here. The lead is the only `kivo-glass-brand` element above the fold, the
 * only one with a full-width primary action, and the only one carrying a live
 * pulse — so "what should I look at right now" has exactly one visual answer
 * instead of six cards of equal weight competing for it.
 *
 * Every lead states its own reason in the eyebrow ("Because you follow
 * Arsenal"). A personalised surface that cannot explain itself reads as
 * arbitrary, and a fan who does not know *why* a match is on their home
 * screen has no way to change it.
 */

const PRIMARY_ACTION =
  "kivo-gradient-prime inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-on-accent kivo-raise focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";
const SECONDARY_ACTION =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-hairline bg-surface-1 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

function LeadShell({
  chip,
  reason,
  children,
  actions,
}: {
  chip: ReactNode;
  reason: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <section
      aria-label="Your lead story"
      className="kivo-glass-brand relative overflow-hidden rounded-2xl p-5"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {chip}
        <p className="text-xs text-foreground-subtle">{reason}</p>
      </div>
      <div className="mt-4">{children}</div>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">{actions}</div>
    </section>
  );
}

function Chip({ tone, icon, label }: { tone: "live" | "accent" | "muted"; icon: ReactNode; label: ReactNode }) {
  const toneClass =
    tone === "live"
      ? "border-live/40 text-live"
      : tone === "accent"
        ? "border-accent/40 text-accent"
        : "border-hairline text-foreground-muted";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${toneClass}`}
    >
      {icon}
      {label}
    </span>
  );
}

/**
 * The scoreboard block, shared by every fixture-shaped lead.
 *
 * Stacked rather than side-by-side, and that is a mobile decision made first:
 * at 390px a `Home ——— score ——— Away` row leaves each club about 90px, which
 * truncated real names to "Arse…" and "Chel…" in the first build of this card.
 * Stacking gives every club the full width of the card, so the two things a
 * fan actually needs — *who* and *what score* — are both legible at a glance
 * on the device most of them will be holding. Desktop keeps the same shape at
 * a larger size; a scoreboard reads perfectly well stacked, and one layout is
 * one set of states to keep honest.
 */
function LeadFixtureBody({ fixture }: { fixture: LeadFixture }) {
  const hasScore = fixture.homeScore !== null && fixture.awayScore !== null;
  return (
    <div className="flex flex-col gap-2">
      {(
        [
          { name: fixture.homeName, crest: fixture.homeCrestUrl, score: fixture.homeScore },
          { name: fixture.awayName, crest: fixture.awayCrestUrl, score: fixture.awayScore },
        ] as const
      ).map((side) => (
        <div key={side.name} className="flex items-center gap-3">
          <TeamCrest crestUrl={side.crest} name={side.name} size={32} />
          <span className="min-w-0 flex-1 truncate text-base font-semibold text-foreground sm:text-lg">{side.name}</span>
          {hasScore && (
            <span className="shrink-0 text-xl font-bold tabular-nums text-foreground sm:text-2xl">{side.score}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** One line under a fixture lead saying whether the viewer has called it.
 * Real state only — it says nothing at all when there is no prediction and no
 * way to make one (a match already under way). */
function PredictionNote({ prediction, kickoffPassed }: { prediction: string | null; kickoffPassed: boolean }) {
  if (prediction) {
    return (
      <p className="mt-3 text-xs text-foreground-muted">
        Your call: <span className="font-semibold text-foreground">{prediction}</span>
      </p>
    );
  }
  if (kickoffPassed) return null;
  return <p className="mt-3 text-xs text-foreground-muted">You haven&apos;t called this one yet.</p>;
}

export function HomeLeadCard({ lead }: { lead: HomeLead }) {
  switch (lead.kind) {
    case "live":
      return (
        <LeadShell
          reason={lead.reason}
          chip={
            <Chip
              tone="live"
              label={lead.fixture.status === "halftime" ? "Half time" : "Live now"}
              icon={<Radio className="h-3 w-3 animate-pulse" strokeWidth={2} />}
            />
          }
          actions={
            <>
              <Link href={`/matches/${lead.fixture.id}`} className={PRIMARY_ACTION}>
                Open Match Centre
                <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
              </Link>
              <Link href={`/matches/${lead.fixture.id}?tab=room`} className={SECONDARY_ACTION}>
                Join the Room
              </Link>
            </>
          }
        >
          <LeadFixtureBody fixture={lead.fixture} />
        </LeadShell>
      );

    case "kickoff":
    case "upcoming": {
      const soon = lead.kind === "kickoff";
      return (
        <LeadShell
          reason={lead.reason}
          chip={
            soon ? (
              <Chip
                tone="accent"
                icon={<CalendarClock className="h-3 w-3" strokeWidth={2} />}
                label="Kicks off soon"
              />
            ) : (
              <Chip tone="muted" icon={<CalendarClock className="h-3 w-3" strokeWidth={2} />} label="Next up" />
            )
          }
          actions={
            <>
              <Link href={`/matches/${lead.fixture.id}`} className={PRIMARY_ACTION}>
                {lead.prediction ? "Open Match Centre" : "Make your call"}
                <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
              </Link>
              <Link href={`/matches/${lead.fixture.id}?tab=room`} className={SECONDARY_ACTION}>
                Match Room
              </Link>
            </>
          }
        >
          <LeadFixtureBody fixture={lead.fixture} />
          {/* Countdown first and in accent when kickoff is close enough to
              plan around; the absolute time stays alongside it, because "3h
              11m" alone can't be checked against a calendar. */}
          <p className="mt-3 flex flex-wrap items-baseline gap-x-2 text-xs text-foreground-muted">
            {soon && (
              <LeadCountdown
                iso={lead.fixture.kickoffAt}
                passedLabel="Under way"
                className="text-sm font-semibold tabular-nums text-accent"
              />
            )}
            <LocalDateTime iso={lead.fixture.kickoffAt} format="deadline" />
          </p>
          <PredictionNote prediction={lead.prediction} kickoffPassed={false} />
        </LeadShell>
      );
    }

    case "fantasy_deadline":
      return (
        <LeadShell
          reason={lead.reason}
          chip={
            <Chip
              tone="accent"
              icon={<Trophy className="h-3 w-3" strokeWidth={2} />}
              label={`Gameweek ${lead.gameweekNumber}`}
            />
          }
          actions={
            <Link href="/fantasy" className={PRIMARY_ACTION}>
              {lead.rosterConfirmed ? "Review your squad" : "Pick your squad"}
              <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
            </Link>
          }
        >
          <p className="text-lg font-semibold text-foreground">
            Locks in{" "}
            <LeadCountdown iso={lead.deadlineAt} passedLabel="moments" className="tabular-nums text-accent" />
          </p>
          <p className="mt-1 text-xs text-foreground-muted">
            Deadline <LocalDateTime iso={lead.deadlineAt} format="deadline" />
          </p>
        </LeadShell>
      );

    case "open_predictions":
      return (
        <LeadShell
          reason={lead.reason}
          chip={<Chip tone="accent" icon={<Target className="h-3 w-3" strokeWidth={2} />} label="Predictions" />}
          actions={
            <Link href="/predictions/mine" className={PRIMARY_ACTION}>
              See your calls
              <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
            </Link>
          }
        >
          <p className="text-lg font-semibold text-foreground">
            {lead.count === 1 ? "1 call still open" : `${lead.count} calls still open`}
          </p>
          <p className="mt-1 text-xs text-foreground-muted">
            Each one locks at its kickoff, and scores when the result is verified.
          </p>
        </LeadShell>
      );

    case "follow_a_club":
      return (
        <LeadShell
          reason={lead.reason}
          chip={<Chip tone="accent" icon={<Star className="h-3 w-3" strokeWidth={2} />} label="Start here" />}
          actions={
            <>
              <Link href="/teams" className={PRIMARY_ACTION}>
                Find your club
                <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
              </Link>
              <Link href="/social" className={SECONDARY_ACTION}>
                Go to the feed
              </Link>
            </>
          }
        >
          <p className="text-lg font-semibold text-foreground">Follow a club and this page becomes yours.</p>
          <p className="mt-1 text-xs text-foreground-muted">
            Their fixtures lead this screen, their goals reach your notifications, and their Match Rooms show up in your
            feed.
          </p>
        </LeadShell>
      );

    case "quiet":
      return (
        <LeadShell
          reason={lead.reason}
          chip={<Chip tone="muted" icon={<CalendarClock className="h-3 w-3" strokeWidth={2} />} label="All quiet" />}
          actions={
            <>
              <Link href="/matches" className={PRIMARY_ACTION}>
                Browse all matches
                <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
              </Link>
              <Link href="/profile/following" className={SECONDARY_ACTION}>
                Manage who you follow
              </Link>
            </>
          }
        >
          <p className="text-lg font-semibold text-foreground">No fixtures on the way for your clubs.</p>
          <p className="mt-1 text-xs text-foreground-muted">
            KIVO only lists matches it has actually verified, so this stays empty until their next fixtures land.
          </p>
        </LeadShell>
      );
  }
}
