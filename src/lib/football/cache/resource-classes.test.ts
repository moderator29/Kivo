import { describe, expect, it } from "vitest";
import {
  RESOURCE_POLICIES,
  classesInvalidatedByFinishedMatch,
  matchResourceClass,
  resourcePolicy,
  type ResourceClass,
} from "./resource-classes";

const ALL_CLASSES = Object.keys(RESOURCE_POLICIES) as ResourceClass[];

describe("RESOURCE_POLICIES invariants", () => {
  it("never declares a stale window shorter than its fresh window", () => {
    // The database refuses this combination outright; asserting it here means a
    // bad policy fails in the test suite rather than at the first write.
    for (const name of ALL_CLASSES) {
      const policy = RESOURCE_POLICIES[name];
      expect(policy.staleSeconds, name).toBeGreaterThanOrEqual(policy.freshSeconds);
    }
  });

  it("gives every class a non-negative window and a rationale somebody can read", () => {
    for (const name of ALL_CLASSES) {
      const policy = RESOURCE_POLICIES[name];
      expect(policy.freshSeconds, name).toBeGreaterThan(0);
      expect(policy.rationale.length, name).toBeGreaterThan(20);
    }
  });

  it("makes live matches the shortest-lived thing KIVO caches", () => {
    const live = RESOURCE_POLICIES.live_match.freshSeconds;
    for (const name of ALL_CLASSES) {
      if (name === "live_match") continue;
      expect(RESOURCE_POLICIES[name].freshSeconds, name).toBeGreaterThanOrEqual(live);
    }
  });

  it("keeps a live score's stale window tight — the one class where old data is worse than none", () => {
    const live = RESOURCE_POLICIES.live_match;
    expect(live.staleSeconds).toBeLessThanOrEqual(120);
    // And the contrast that makes the rule visible: a league table may be served
    // days old, because a day-old table is still a table.
    expect(RESOURCE_POLICIES.standings.staleSeconds).toBeGreaterThan(live.staleSeconds * 100);
  });

  it("never serves a stale provider status — a wrong quota number gets believed", () => {
    const status = RESOURCE_POLICIES.provider_status;
    expect(status.staleSeconds).toBe(status.freshSeconds);
  });

  it("gives the three in-play match views the same window so they cannot disagree", () => {
    const windows = [
      RESOURCE_POLICIES.match_lineups.freshSeconds,
      RESOURCE_POLICIES.match_events.freshSeconds,
      RESOURCE_POLICIES.match_statistics.freshSeconds,
    ];
    expect(new Set(windows).size).toBe(1);
  });

  it("caches a finished match far longer than an upcoming one", () => {
    expect(RESOURCE_POLICIES.completed_match.freshSeconds).toBeGreaterThan(
      RESOURCE_POLICIES.upcoming_match.freshSeconds,
    );
  });

  it("only ever names a bucket the request ledger knows about", () => {
    const known = new Set(["live", "auto", "daily", "catalogue", null]);
    for (const name of ALL_CLASSES) {
      expect(known.has(RESOURCE_POLICIES[name].bucket), name).toBe(true);
    }
  });
});

describe("classesInvalidatedByFinishedMatch", () => {
  it("enrols standings, because a full-time whistle is proof a table changed", () => {
    expect(classesInvalidatedByFinishedMatch()).toContain("standings");
  });

  it("does not enrol player season stats — one finished match must not expire every player in the league", () => {
    expect(classesInvalidatedByFinishedMatch()).not.toContain("player_season_stats");
  });
});

describe("matchResourceClass", () => {
  it("splits one endpoint's three kinds of match apart", () => {
    expect(matchResourceClass("live")).toBe("live_match");
    expect(matchResourceClass("halftime")).toBe("live_match");
    expect(matchResourceClass("finished")).toBe("completed_match");
    expect(matchResourceClass("scheduled")).toBe("upcoming_match");
  });

  it("treats an abandoned or cancelled match as completed — it will not change again", () => {
    expect(matchResourceClass("abandoned")).toBe("completed_match");
    expect(matchResourceClass("cancelled")).toBe("completed_match");
  });

  it("resolves an unknown or missing status to the conservative class, not the longest-lived one", () => {
    // Refreshed sooner rather than frozen for two days.
    expect(matchResourceClass("something-new")).toBe("upcoming_match");
    expect(matchResourceClass(null)).toBe("upcoming_match");
    expect(matchResourceClass(undefined)).toBe("upcoming_match");
  });

  it("is not fooled by casing or padding from a provider's status string", () => {
    expect(matchResourceClass("  LIVE ")).toBe("live_match");
  });
});

describe("resourcePolicy", () => {
  it("returns the same object the table holds, for every class", () => {
    for (const name of ALL_CLASSES) {
      expect(resourcePolicy(name)).toBe(RESOURCE_POLICIES[name]);
    }
  });
});
