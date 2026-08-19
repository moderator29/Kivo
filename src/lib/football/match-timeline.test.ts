import { describe, expect, it } from "vitest";
import {
  compareTimelineEvents,
  resolveEventSide,
  resolveTabFromSlug,
  type OrderableEvent,
} from "./match-timeline";

function event(id: string, minute: number, addedTime: number | null = null): OrderableEvent {
  return { id, minute, addedTime };
}

describe("compareTimelineEvents", () => {
  it("orders by minute ascending, matching the server's own order", () => {
    const sorted = [event("c", 67), event("a", 12), event("b", 45)].sort(compareTimelineEvents);
    expect(sorted.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("puts stoppage time after the minute it is added to", () => {
    const sorted = [event("plus4", 90, 4), event("flat", 90), event("plus1", 90, 1)].sort(compareTimelineEvents);
    expect(sorted.map((e) => e.id)).toEqual(["flat", "plus1", "plus4"]);
  });

  it("does not let a 90+1 event outrank a later normal minute", () => {
    // Regression guard for the obvious wrong implementation, minute + addedTime:
    // that makes 90+4 (94) sort after a 93rd-minute event, which is backwards —
    // 93' is played before stoppage time is announced.
    const sorted = [event("stoppage", 90, 4), event("ninetyThree", 93)].sort(compareTimelineEvents);
    expect(sorted.map((e) => e.id)).toEqual(["stoppage", "ninetyThree"]);
  });

  it("is stable for two events in the same minute, so they never swap between renders", () => {
    const first = [event("zulu", 30), event("alpha", 30)].sort(compareTimelineEvents);
    const second = [event("alpha", 30), event("zulu", 30)].sort(compareTimelineEvents);
    expect(first.map((e) => e.id)).toEqual(second.map((e) => e.id));
  });

  it("treats a null added time as zero rather than sorting it apart from 0", () => {
    expect(compareTimelineEvents(event("a", 45, null), event("b", 45, 0))).toBeLessThan(0);
  });
});

describe("resolveEventSide", () => {
  it("resolves each club to its own side", () => {
    expect(resolveEventSide("home-id", "home-id", "away-id")).toBe("home");
    expect(resolveEventSide("away-id", "home-id", "away-id")).toBe("away");
  });

  it("returns null for a team on neither side rather than guessing one", () => {
    expect(resolveEventSide("merged-club-id", "home-id", "away-id")).toBeNull();
  });

  it("does not match an unresolved fixture team against an empty event team", () => {
    // The fixture page passes "" when a fixture's home/away team didn't
    // resolve. Two unknowns are not a match, and an event silently pinned to
    // the "home" side would be a claim KIVO cannot support.
    expect(resolveEventSide("", "", "away-id")).toBeNull();
    expect(resolveEventSide("some-team", "", "")).toBeNull();
  });
});

describe("resolveTabFromSlug", () => {
  const toSlug = (tab: string) => tab.toLowerCase();
  const visible = ["Timeline", "Stats", "Standings", "Room"] as const;

  it("picks the tab whose slug matches", () => {
    expect(resolveTabFromSlug("stats", visible, toSlug)).toBe("Stats");
  });

  it("honours a renamed tab's old slug so shared links keep working", () => {
    expect(resolveTabFromSlug("details", visible, toSlug, { details: "Timeline" })).toBe("Timeline");
  });

  it("ignores a legacy slug whose tab is not currently on screen", () => {
    // The data tabs collapse to a single Overview when none of them hold
    // anything. An old ?tab=details link then names a tab the strip isn't
    // showing, and highlighting nothing is worse than landing on Overview.
    const collapsed = ["Overview", "Standings", "Room"] as const;
    expect(resolveTabFromSlug("details", collapsed, toSlug, { details: "Timeline" })).toBe("Overview");
  });

  it("falls back to the first visible tab, not a fixed one", () => {
    expect(resolveTabFromSlug("heatmap", visible, toSlug)).toBe("Timeline");
    expect(resolveTabFromSlug(null, visible, toSlug)).toBe("Timeline");
  });
});
