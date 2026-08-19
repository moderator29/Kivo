import { describe, expect, it } from "vitest";
import { matchRoomWindow } from "./match-room-window";

/** 15:00 on a Saturday, the kickoff every test below is measured from. */
const KICKOFF = "2026-08-15T15:00:00.000Z";

/** Minutes after kickoff, as a Date. Negative is before kickoff. */
function at(minutes: number): Date {
  return new Date(new Date(KICKOFF).getTime() + minutes * 60_000);
}

describe("matchRoomWindow", () => {
  it("is open before kickoff — the founder's rule, and the point of a room", () => {
    // "make it open even if the match is not live yet ... make it open for
    // people to chat about for that match". A week out is still open.
    expect(matchRoomWindow(KICKOFF, "scheduled", at(-60 * 24 * 7))).toEqual({
      open: true,
      phase: "pre-match",
    });
    expect(matchRoomWindow(KICKOFF, "scheduled", at(-1))).toEqual({ open: true, phase: "pre-match" });
  });

  it("reports pre-match rather than open, so the UI can say the match hasn't started", () => {
    // Both are open. The phase is what lets the Room say which kind of open it
    // is instead of implying the match is under way.
    expect(matchRoomWindow(KICKOFF, "scheduled", at(-30)).phase).toBe("pre-match");
    expect(matchRoomWindow(KICKOFF, "live", at(30)).phase).toBe("open");
  });

  it("is open at kickoff and all the way through the match", () => {
    expect(matchRoomWindow(KICKOFF, "live", at(0))).toEqual({ open: true, phase: "open" });
    expect(matchRoomWindow(KICKOFF, "halftime", at(50))).toEqual({ open: true, phase: "open" });
    expect(matchRoomWindow(KICKOFF, "live", at(95))).toEqual({ open: true, phase: "open" });
  });

  it("stays open for a full day after the match ends", () => {
    // Expected end is kickoff + 120 minutes; the room runs 24h past that.
    const oneMinuteBeforeClose = at(120 + 24 * 60 - 1);
    expect(matchRoomWindow(KICKOFF, "finished", oneMinuteBeforeClose)).toEqual({
      open: true,
      phase: "open",
    });
  });

  it("closes 24 hours after the expected final whistle, not 24 hours after kickoff", () => {
    // The distinction is the whole reason EXPECTED_MATCH_MINUTES exists: at
    // kickoff + 24h the match ended only 22 hours ago and the room must still
    // be open.
    expect(matchRoomWindow(KICKOFF, "finished", at(24 * 60)).open).toBe(true);

    const closed = matchRoomWindow(KICKOFF, "finished", at(120 + 24 * 60));
    expect(closed.open).toBe(false);
    expect(closed.phase).toBe("closed");
  });

  it("reports when it closed, so the Room can say so instead of just refusing", () => {
    const closed = matchRoomWindow(KICKOFF, "finished", at(120 + 30 * 60));
    expect(closed).toMatchObject({ open: false, phase: "closed" });
    if (closed.open) throw new Error("expected a closed window");
    // kickoff + 2h + 24h = 17:00 the following day.
    expect(closed.closedAt).toBe("2026-08-16T17:00:00.000Z");
  });

  it("closes a cancelled or postponed match 24h after its kickoff time", () => {
    // A match nobody played has no final whistle to measure from, so its own
    // scheduled kickoff is the only honest anchor. Still open a day either
    // side of it — people have plenty to say about a postponement.
    for (const status of ["cancelled", "postponed", "abandoned"] as const) {
      expect(matchRoomWindow(KICKOFF, status, at(-60)).open).toBe(true);
      expect(matchRoomWindow(KICKOFF, status, at(23 * 60)).open).toBe(true);
      expect(matchRoomWindow(KICKOFF, status, at(24 * 60)).open).toBe(false);
    }
  });

  it("does not close a room because a kickoff time could not be parsed", () => {
    // The failure that matters is silencing a conversation about a real match.
    // An unreadable timestamp is KIVO's problem, not the reader's.
    expect(matchRoomWindow("not a date", "scheduled", at(0))).toEqual({ open: true, phase: "open" });
    expect(matchRoomWindow("", "live", at(0))).toEqual({ open: true, phase: "open" });
  });

  it("is exactly closed at the boundary, not a second either side of it", () => {
    const closesAt = at(120 + 24 * 60);
    expect(matchRoomWindow(KICKOFF, "finished", new Date(closesAt.getTime() - 1)).open).toBe(true);
    expect(matchRoomWindow(KICKOFF, "finished", closesAt).open).toBe(false);
  });

  it("treats an unknown status like a match that will be played", () => {
    // `unknown` is what the provider mapper falls back to. It must not shorten
    // the window to the abandoned one — a live match whose status failed to map
    // would then lock its own room mid-game.
    expect(matchRoomWindow(KICKOFF, "unknown", at(23 * 60)).open).toBe(true);
    expect(matchRoomWindow(KICKOFF, "unknown", at(120 + 24 * 60 - 1)).open).toBe(true);
  });
});
