import { formatDurationUntil } from "@/lib/format";

/**
 * The briefing at the top of /home: everything KIVO actually knows about this
 * reader's day, in one short list.
 *
 * ## Why this is not written by the model
 *
 * The founding directive names an "AI daily briefing". This composes the
 * briefing deterministically from real rows and offers the Copilot as the way
 * to ask *about* it, rather than generating prose on every Home render. Three
 * reasons, all of which the directive itself already argues for:
 *
 *   - The directive's own AI architecture is "deterministic retrieval first,
 *     LLM second — the model explains verified structured data, it doesn't
 *     invent it". A briefing is exactly the retrieval half.
 *   - "An AI outage must never break core football functionality." Home is
 *     the first screen of every session; putting a model call on its critical
 *     path makes the whole product's front door depend on a third party.
 *   - A generated paragraph would be a new claim on every render, unreviewable
 *     and uncacheable. These lines are the same facts the sections below show,
 *     said once, and each links to the surface it came from.
 *
 * The AI-branded half — the "ask about any of this" line — is gated on
 * `isAiConfigured()`, so Home says the same thing about the Copilot that the
 * navigation does. When the key is absent the briefing is still a real, useful
 * briefing; it just doesn't offer something that isn't there.
 *
 * ## The omission rule
 *
 * A line exists because a row exists. There is no "no matches today" line, no
 * "0 predictions open", no filler to reach a minimum length. An empty list
 * means no briefing card at all.
 */

export type BriefingLine = {
  id: string;
  /** The sentence, already complete — callers render it verbatim. */
  text: string;
  /** Where the fact came from, so a briefing line is always traceable to the
   * surface that owns it. */
  href: string;
};

export type HomeBriefingFacts = {
  now: number;
  /** Followed clubs with a fixture today. `liveCount` is a subset. */
  clubsToday: { count: number; liveCount: number; nextKickoffAt: string | null; firstFixtureId: string | null };
  /** `gameweekNumber` is only ever read alongside a real `deadlineAt`, so it
   * is nullable rather than defaulted — there is no such thing as gameweek 0,
   * and a placeholder here would eventually print one. */
  fantasy: {
    gameweekNumber: number | null;
    deadlineAt: string | null;
    rosterConfirmed: boolean;
    latestPoints: number | null;
  } | null;
  predictions: { openCount: number; currentStreak: number } | null;
  /** The single most recent completed move involving someone they follow. */
  latestTransfer: { playerName: string; toTeamName: string | null; dateLabel: string } | null;
  /** The busiest Room KIVO can see, only when it genuinely has people in it. */
  trendingRoom: { label: string; fixtureId: string } | null;
  unreadNotificationCount: number;
};

export function buildHomeBriefing(facts: HomeBriefingFacts): BriefingLine[] {
  const lines: BriefingLine[] = [];

  if (facts.clubsToday.liveCount > 0) {
    lines.push({
      id: "live",
      text:
        facts.clubsToday.liveCount === 1
          ? "One of your clubs is playing right now."
          : `${facts.clubsToday.liveCount} of your clubs are playing right now.`,
      href: "/live",
    });
  } else if (facts.clubsToday.count > 0) {
    // A countdown only appears when the kickoff is genuinely in the future —
    // `formatDurationUntil` returns null once it isn't, and the line drops the
    // countdown clause rather than printing a stale one.
    const countdown = facts.clubsToday.nextKickoffAt
      ? formatDurationUntil(facts.clubsToday.nextKickoffAt, facts.now)
      : null;
    lines.push({
      id: "clubs-today",
      text:
        facts.clubsToday.count === 1
          ? `One of your clubs plays today${countdown ? `, in ${countdown}` : ""}.`
          : `${facts.clubsToday.count} of your clubs play today${countdown ? `, the first in ${countdown}` : ""}.`,
      href: facts.clubsToday.firstFixtureId ? `/matches/${facts.clubsToday.firstFixtureId}` : "/matches",
    });
  }

  if (facts.fantasy) {
    const countdown = facts.fantasy.deadlineAt ? formatDurationUntil(facts.fantasy.deadlineAt, facts.now) : null;
    if (countdown && facts.fantasy.gameweekNumber !== null && !facts.fantasy.rosterConfirmed) {
      lines.push({
        id: "fantasy-deadline",
        text: `Gameweek ${facts.fantasy.gameweekNumber} locks in ${countdown} and your squad isn't confirmed.`,
        href: "/fantasy",
      });
    } else if (countdown && facts.fantasy.gameweekNumber !== null) {
      lines.push({
        id: "fantasy-confirmed",
        text: `Your Gameweek ${facts.fantasy.gameweekNumber} squad is in. Locks in ${countdown}.`,
        href: "/fantasy",
      });
    } else if (facts.fantasy.latestPoints !== null) {
      // Only a genuinely scored gameweek. An unscored one has no points, and
      // "0 points" would read as a bad week rather than as "not calculated".
      lines.push({
        id: "fantasy-points",
        text: `You scored ${facts.fantasy.latestPoints} in your last fantasy gameweek.`,
        href: "/fantasy",
      });
    }
  }

  if (facts.predictions?.openCount) {
    lines.push({
      id: "predictions-open",
      text:
        facts.predictions.openCount === 1
          ? "You have one call that hasn't locked yet."
          : `You have ${facts.predictions.openCount} calls that haven't locked yet.`,
      href: "/predictions/mine",
    });
  } else if (facts.predictions && facts.predictions.currentStreak > 1) {
    // A "streak" of one is just a correct prediction. Two is a run.
    lines.push({
      id: "predictions-streak",
      text: `You're on a run of ${facts.predictions.currentStreak} correct calls.`,
      href: "/predictions/mine",
    });
  }

  if (facts.latestTransfer) {
    lines.push({
      id: "transfer",
      text: facts.latestTransfer.toTeamName
        ? `${facts.latestTransfer.playerName} joined ${facts.latestTransfer.toTeamName} on ${facts.latestTransfer.dateLabel}.`
        : `${facts.latestTransfer.playerName} moved on ${facts.latestTransfer.dateLabel}.`,
      href: "/transfers",
    });
  }

  if (facts.trendingRoom) {
    lines.push({
      id: "room",
      text: facts.trendingRoom.label,
      href: `/matches/${facts.trendingRoom.fixtureId}`,
    });
  }

  if (facts.unreadNotificationCount > 0) {
    lines.push({
      id: "notifications",
      text:
        facts.unreadNotificationCount === 1
          ? "One notification you haven't read."
          : `${facts.unreadNotificationCount} notifications you haven't read.`,
      href: "/notifications",
    });
  }

  return lines;
}
