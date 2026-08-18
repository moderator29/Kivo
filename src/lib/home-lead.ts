import type { FixtureStatus } from "@/lib/football/fixture-status";

/**
 * The deterministic priority ladder behind /home's lead slot (KN-37).
 *
 * Context for why this exists at all: KIVO is now fully gated — there is no
 * guest preview of the product (see src/app/(app)/layout.tsx) — so /home is
 * the first screen every session starts on, and every render can assume a
 * known identity. Before this, /home was six `kivo-glass` cards of identical
 * visual weight in a fixed order, which meant the page had no answer to the
 * only question a fan actually opens it with: *what should I look at right
 * now*.
 *
 * This module answers that question and nothing else. It is deliberately:
 *
 * - **Pure.** No Supabase, no clock of its own (`now` is passed in), no React.
 *   The page does the querying, this decides the ranking, and the ranking is
 *   unit-tested against real orderings rather than eyeballed on a screenshot.
 * - **Deterministic and explainable.** Every lead carries its own `reason`
 *   string — "Because you follow Arsenal", "You're in a fantasy league" — so
 *   the user is never shown a personalised card without being told what put
 *   it there. This is emphatically *not* a ranked "for you" feed with a
 *   hidden scoring formula (RECOMMENDATIONS.md item 256); it is a fixed
 *   ladder over facts /home already fetches, and a reader of this file can
 *   predict exactly what any given user will see.
 * - **Never fabricated.** Every input is a real row: a followed team's
 *   fixture, the viewer's own prediction, their own fantasy gameweek
 *   deadline. When none of them exist the ladder says so honestly
 *   (`follow_a_club` / `quiet`) instead of inventing something to fill the
 *   slot.
 */

export type LeadFixture = {
  id: string;
  kickoffAt: string;
  status: FixtureStatus;
  homeName: string;
  homeCrestUrl: string | null;
  awayName: string;
  awayCrestUrl: string | null;
  homeScore: number | null;
  awayScore: number | null;
  /** Which followed/favourite club put this fixture on the viewer's screen.
   * Null only if the team row behind the follow could not be resolved — the
   * lead then omits the "because you follow X" half of its reason rather
   * than guessing at a club name. */
  followedTeamName: string | null;
};

export type HomeLeadFacts = {
  /** Injected so the ladder is testable and so the page's own clock is the
   * single clock — nothing in here reads Date.now() on its own. */
  now: number;
  followedTeamCount: number;
  /** A followed club playing at this exact moment (`live` or `halftime`). */
  liveFixture: LeadFixture | null;
  /** The soonest future kickoff among followed clubs, whenever it is. */
  nextFixture: LeadFixture | null;
  /** The viewer's own call on `nextFixture`, already formatted ("Home win"),
   * or null if they haven't predicted it. Drives the difference between
   * "make your call" and "your call is in". */
  nextFixturePrediction: string | null;
  /** Predictions the viewer has made that haven't locked yet. */
  openPredictionCount: number;
  /** The viewer's next fantasy deadline — only ever populated when they
   * actually have a fantasy team, so this can never nag a non-player. */
  fantasy: { gameweekNumber: number; deadlineAt: string; rosterConfirmed: boolean } | null;
};

export type HomeLead =
  | { kind: "live"; reason: string; fixture: LeadFixture }
  | { kind: "kickoff"; reason: string; fixture: LeadFixture; prediction: string | null }
  | { kind: "fantasy_deadline"; reason: string; gameweekNumber: number; deadlineAt: string; rosterConfirmed: boolean }
  | { kind: "open_predictions"; reason: string; count: number }
  | { kind: "upcoming"; reason: string; fixture: LeadFixture; prediction: string | null }
  | { kind: "follow_a_club"; reason: string }
  | { kind: "quiet"; reason: string };

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far ahead a kickoff still counts as "today's business" and outranks a
 * fantasy deadline. A day, because that is the horizon a fan plans a match
 * around; past it, a deadline you can still act on is the more useful thing
 * to lead with. */
export const KICKOFF_LEAD_WINDOW_MS = DAY_MS;

/** A fantasy deadline further out than this isn't news yet — leading with
 * "GW12 locks in 11 days" would push a real fixture down the page for no
 * reason. */
export const FANTASY_LEAD_WINDOW_MS = 7 * DAY_MS;

function clubReason(fixture: LeadFixture, fallback: string): string {
  return fixture.followedTeamName ? `Because you follow ${fixture.followedTeamName}` : fallback;
}

/**
 * The ladder, in order. Read top to bottom — that *is* the specification:
 *
 * 1. a club you follow is playing right now
 * 2. …or kicks off within a day
 * 3. …or your fantasy gameweek locks within a week
 * 4. …or you have predictions still open
 * 5. …or a club you follow plays at some point
 * 6. …or you follow nobody yet, so that's the one thing worth doing
 * 7. …or KIVO genuinely has nothing for you, and says so
 */
export function selectHomeLead(facts: HomeLeadFacts): HomeLead {
  if (facts.liveFixture) {
    return {
      kind: "live",
      reason: clubReason(facts.liveFixture, "Live right now"),
      fixture: facts.liveFixture,
    };
  }

  const msToKickoff = facts.nextFixture ? new Date(facts.nextFixture.kickoffAt).getTime() - facts.now : null;

  if (facts.nextFixture && msToKickoff !== null && msToKickoff <= KICKOFF_LEAD_WINDOW_MS) {
    return {
      kind: "kickoff",
      reason: clubReason(facts.nextFixture, "Kicking off soon"),
      fixture: facts.nextFixture,
      prediction: facts.nextFixturePrediction,
    };
  }

  if (facts.fantasy) {
    const msToDeadline = new Date(facts.fantasy.deadlineAt).getTime() - facts.now;
    if (msToDeadline > 0 && msToDeadline <= FANTASY_LEAD_WINDOW_MS) {
      return {
        kind: "fantasy_deadline",
        reason: facts.fantasy.rosterConfirmed
          ? "Your squad is in for this gameweek"
          : "Your fantasy squad isn't confirmed yet",
        gameweekNumber: facts.fantasy.gameweekNumber,
        deadlineAt: facts.fantasy.deadlineAt,
        rosterConfirmed: facts.fantasy.rosterConfirmed,
      };
    }
  }

  if (facts.openPredictionCount > 0) {
    return {
      kind: "open_predictions",
      reason: "Calls you've made that haven't locked yet",
      count: facts.openPredictionCount,
    };
  }

  if (facts.nextFixture) {
    return {
      kind: "upcoming",
      reason: clubReason(facts.nextFixture, "Next on your calendar"),
      fixture: facts.nextFixture,
      prediction: facts.nextFixturePrediction,
    };
  }

  if (facts.followedTeamCount === 0) {
    return {
      kind: "follow_a_club",
      reason: "KIVO builds this page around the clubs you follow",
    };
  }

  return {
    kind: "quiet",
    reason: "Nothing scheduled for your clubs yet",
  };
}
