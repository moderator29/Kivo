import type { FixtureStatus } from "@/lib/football/fixture-status";

/**
 * When a Match Room accepts new posts.
 *
 * The founder's rule, in their words: "make it open even if the match is not
 * live yet — should only be closed to chat after 24hrs after match ended."
 *
 * So the room opens the moment the fixture exists, not at kickoff. Arguing
 * about a match beforehand is most of the point of having a room at all, and a
 * room that only unlocks at kickoff is empty exactly when anticipation is
 * highest.
 *
 * WHY "TWO HOURS" APPEARS BELOW, AND WHY IT IS NOT A GUESS DRESSED UP
 * ---------------------------------------------------------------------------
 * KIVO does not record when a match ENDED. `fixtures` carries `kickoff_at` and
 * a status, and nothing writes a finish time — so "24 hours after the match
 * ended" cannot be computed exactly from what exists. The options were to
 * invent a finish time, to add a column and backfill it with a guess, or to
 * say plainly what is being approximated.
 *
 * This takes the third. The window closes 24 hours after the match's expected
 * end, and the expected end is kickoff plus two hours — 90 minutes plus
 * half-time plus stoppage, which is the length of essentially every football
 * match that does not go to extra time. A match that does go to extra time and
 * penalties runs perhaps 40 minutes longer, so the room closes 23 hours after
 * that one ends rather than 24. That error is in the harmless direction and it
 * is stated here rather than hidden.
 *
 * If a real finish time is ever recorded, this function is the one place to
 * change, and the constant below stops being an approximation.
 */

/** Kickoff to final whistle: 90 minutes, half-time, and stoppage. */
const EXPECTED_MATCH_MINUTES = 120;

/** How long after the final whistle the room stays open. The founder's number. */
const OPEN_AFTER_FULL_TIME_HOURS = 24;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export type MatchRoomWindow =
  /** Before kickoff. Open — and the UI says the match has not started rather
   * than implying the room is unavailable. */
  | { open: true; phase: "pre-match" }
  /** Kickoff through the 24 hours after the expected final whistle. */
  | { open: true; phase: "open" }
  /** Past the window. The room becomes readable history. */
  | { open: false; phase: "closed"; closedAt: string };

/**
 * `now` is a parameter rather than read inside, so this is a pure function the
 * tests can move through time and both the server action and the UI can agree
 * on without one of them drifting.
 */
export function matchRoomWindow(
  kickoffAt: string,
  status: FixtureStatus,
  now: Date = new Date(),
): MatchRoomWindow {
  const kickoff = new Date(kickoffAt);

  // An unparseable kickoff must not close a room. The failure direction that
  // matters here is silencing a conversation about a real match, not allowing
  // one about an old one.
  if (Number.isNaN(kickoff.getTime())) return { open: true, phase: "open" };

  // A match nobody will ever play has no room to keep open — but it also has
  // no "end", so it is treated as closed once its own kickoff time has passed.
  const abandoned = status === "cancelled" || status === "postponed" || status === "abandoned";

  const expectedEnd = new Date(kickoff.getTime() + EXPECTED_MATCH_MINUTES * MINUTE_MS);
  const closesAt = new Date(
    (abandoned ? kickoff.getTime() : expectedEnd.getTime()) + OPEN_AFTER_FULL_TIME_HOURS * HOUR_MS,
  );

  if (now.getTime() >= closesAt.getTime()) {
    return { open: false, phase: "closed", closedAt: closesAt.toISOString() };
  }

  if (now.getTime() < kickoff.getTime()) return { open: true, phase: "pre-match" };
  return { open: true, phase: "open" };
}
