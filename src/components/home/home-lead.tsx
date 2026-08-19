import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, CalendarClock, Radio, Star, Target, Trophy } from "lucide-react";
import type { HomeLead, LeadFixture } from "@/lib/home-lead";
import { TeamCrest } from "@/components/ui/team-crest";
import { LocalDateTime } from "@/components/ui/relative-time";
import { LeadCountdown } from "@/components/home/lead-countdown";

/**
 * /home's lead slot — the one thing on the page allowed to shout.
 *
 * What it shows is decided entirely by `selectHomeLead`
 * (src/lib/home-lead.ts); this component only renders the decision, which is
 * why the ladder is unit-testable and this file has no branching logic of its
 * own beyond one `switch`.
 *
 * ## Why it is the only feature container on the page
 *
 * `CONTAINER_ROLES.feature` in src/lib/design-system.ts: "Rare, and earns it:
 * a hero, a live match header, a moment the user earned… More than one on a
 * screen means none of them is a feature." Everything else on /home is now a
 * heading over a hairline-divided surface, so this is the single element with
 * a 3xl radius, the brand ring and its own gradient — and that contrast is
 * the entire reason a reader's eye lands here first instead of scanning eight
 * equal boxes for the point of the page.
 *
 * ## The scoreboard
 *
 * Crests over names, score between them. The previous build stacked the two
 * clubs as rows with the score right-aligned, on the reasoning that a 390px
 * phone truncates a side-by-side layout — true of a *single-line* one. Giving
 * each club its own column and letting the name wrap under the crest solves
 * the same problem without giving up the shape a scoreline actually has, and
 * it is the shape every reference app draws its featured match in. Nothing is
 * abbreviated and nothing is truncated: "Wolverhampton Wanderers" wraps.
 *
 * Every lead states its own reason ("Because you follow Arsenal"). This is now
 * the *only* place on /home that explains itself, which is what keeps the
 * explanation worth reading — the sections below it carry facts, not
 * justifications.
 */

const PRIMARY_ACTION =
  "kivo-gradient-prime inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-on-accent kivo-raise focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";
const SECONDARY_ACTION =
  "inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-hairline bg-surface-1 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

function LeadShell({
  chip,
  context,
  reason,
  children,
  actions,
}: {
  chip: ReactNode;
  /** The competition, or whatever else names where this sits. Often null. */
  context?: string | null;
  reason: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <section
      aria-label="Your lead story"
      className="kivo-glass-brand relative flex flex-col gap-4 overflow-hidden rounded-3xl p-6 sm:p-7"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {chip}
        {context && <span className="min-w-0 truncate text-xs font-medium text-foreground-muted">{context}</span>}
      </div>
      {children}
      <div className="flex flex-col gap-2 sm:flex-row">{actions}</div>
      <p className="text-xs text-foreground-subtle">{reason}</p>
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
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold uppercase tracking-wider ${toneClass}`}
    >
      {icon}
      {label}
    </span>
  );
}

/** One club: crest, then its full name under it. `break-words` rather than
 * `truncate` — a lead that cannot name both clubs has failed at the one job it
 * has. */
function LeadSide({ name, crestUrl }: { name: string; crestUrl: string | null }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
      <TeamCrest crestUrl={crestUrl} name={name} size={44} />
      {/* `break-words` breaks a word only when it genuinely cannot fit, so
          "Wolverhampton Wanderers" wraps at its space rather than mid-word. */}
      <span className="text-sm font-semibold leading-snug text-foreground break-words">{name}</span>
    </div>
  );
}

/**
 * The scoreboard. The middle column carries whichever of the three things is
 * true: a real score, a countdown to kickoff, or the kickoff time itself. It
 * never carries a dash standing in for a score that does not exist.
 */
function LeadFixtureBody({ fixture, soon }: { fixture: LeadFixture; soon: boolean }) {
  const hasScore = fixture.homeScore !== null && fixture.awayScore !== null;

  return (
    <div className="flex items-start justify-center gap-2">
      <LeadSide name={fixture.homeName} crestUrl={fixture.homeCrestUrl} />
      <div className="flex w-[4.5rem] shrink-0 flex-col items-center gap-1 pt-2 sm:w-28">
        {hasScore ? (
          <span className="text-3xl font-bold tabular-nums leading-none text-foreground sm:text-4xl">
            {fixture.homeScore}
            <span className="px-1.5 text-foreground-subtle">-</span>
            {fixture.awayScore}
          </span>
        ) : soon ? (
          <>
            {/* A countdown is the useful number inside the kickoff window, and
                the absolute time stays under it because "3h 11m" alone cannot
                be checked against a calendar. */}
            <LeadCountdown
              iso={fixture.kickoffAt}
              passedLabel="Under way"
              className="text-2xl font-bold tabular-nums leading-none text-accent"
            />
            <span className="text-center text-xs leading-snug text-foreground-subtle">
              <LocalDateTime iso={fixture.kickoffAt} format="deadline" />
            </span>
          </>
        ) : (
          // Further out than a day, where a countdown reads as a stopwatch on
          // something nobody is waiting for. Day and time, nothing else.
          <span className="text-center text-sm font-semibold leading-snug text-foreground">
            <LocalDateTime iso={fixture.kickoffAt} format="deadline" />
          </span>
        )}
      </div>
      <LeadSide name={fixture.awayName} crestUrl={fixture.awayCrestUrl} />
    </div>
  );
}

/** One line saying whether the viewer has called it. Real state only — it says
 * nothing at all when there is no prediction and no way to make one. */
function PredictionNote({ prediction }: { prediction: string | null }) {
  if (!prediction) return null;
  return (
    <p className="text-center text-xs text-foreground-muted">
      Your call: <span className="font-semibold text-foreground">{prediction}</span>
    </p>
  );
}

/** The headline shape for the leads that are not a fixture. */
function LeadStatement({ headline, detail }: { headline: string; detail: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xl font-semibold leading-tight tracking-tight text-foreground">{headline}</p>
      <p className="text-sm leading-snug text-foreground-muted">{detail}</p>
    </div>
  );
}

export function HomeLeadCard({ lead }: { lead: HomeLead }) {
  switch (lead.kind) {
    case "live":
      return (
        <LeadShell
          reason={lead.reason}
          context={lead.fixture.competitionName}
          chip={
            <Chip
              tone="live"
              label={
                lead.fixture.status === "halftime"
                  ? "Half time"
                  : lead.fixture.minuteElapsed != null
                    ? `${lead.fixture.minuteElapsed}'`
                    : "Live"
              }
              icon={<Radio className="h-3 w-3 motion-safe:animate-pulse" strokeWidth={2} />}
            />
          }
          actions={
            <>
              <Link href={`/matches/${lead.fixture.id}`} className={PRIMARY_ACTION}>
                Match Centre
                <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
              </Link>
              <Link href={`/matches/${lead.fixture.id}?tab=room`} className={SECONDARY_ACTION}>
                Join the Room
              </Link>
            </>
          }
        >
          <LeadFixtureBody fixture={lead.fixture} soon={false} />
        </LeadShell>
      );

    case "kickoff":
    case "upcoming": {
      const soon = lead.kind === "kickoff";
      return (
        <LeadShell
          reason={lead.reason}
          context={lead.fixture.competitionName}
          chip={
            <Chip
              tone={soon ? "accent" : "muted"}
              icon={<CalendarClock className="h-3 w-3" strokeWidth={2} />}
              label={soon ? "Kicks off soon" : "Next up"}
            />
          }
          actions={
            <>
              <Link href={`/matches/${lead.fixture.id}`} className={PRIMARY_ACTION}>
                {lead.prediction ? "Match Centre" : "Make your call"}
                <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
              </Link>
              <Link href={`/matches/${lead.fixture.id}?tab=room`} className={SECONDARY_ACTION}>
                Match Room
              </Link>
            </>
          }
        >
          <LeadFixtureBody fixture={lead.fixture} soon={soon} />
          <PredictionNote prediction={lead.prediction} />
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
          <div className="flex flex-col gap-1.5">
            <p className="text-xl font-semibold leading-tight tracking-tight text-foreground">
              Locks in{" "}
              <LeadCountdown iso={lead.deadlineAt} passedLabel="moments" className="tabular-nums text-accent" />
            </p>
            <p className="text-sm text-foreground-muted">
              Deadline <LocalDateTime iso={lead.deadlineAt} format="deadline" />
            </p>
          </div>
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
          <LeadStatement
            headline={lead.count === 1 ? "1 call still open" : `${lead.count} calls still open`}
            detail="Each one locks at its kickoff, and scores when the result is verified."
          />
        </LeadShell>
      );

    case "follow_a_club":
      // The most-read empty state in the product: a brand-new account, before
      // a single follow. It is written as an invitation with a concrete next
      // step and a description of what changes — never as an apology for a
      // blank page, and never with a fabricated preview of what it would look
      // like full.
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
          <LeadStatement
            headline="Follow a club and this page becomes yours."
            detail="Their fixtures lead this screen, their goals reach your notifications, and their Match Rooms show up in your feed."
          />
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
          <LeadStatement
            headline="No fixtures on the way for your clubs."
            detail="KIVO only lists matches it has verified, so this fills in the moment their next fixtures land."
          />
        </LeadShell>
      );
  }
}
