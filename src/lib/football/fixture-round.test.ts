import { describe, expect, it } from "vitest";
import { roundText } from "@/lib/football/round-label";

/**
 * How the Match Centre names a fixture's round.
 *
 * The bug this pins is the one that made the column necessary: `matchday` is a
 * NUMBER parsed out of the provider's round label, and `parseMatchday`
 * correctly returns null for anything without one. So for every cup tie the
 * label was parsed, found to contain no number, and thrown away — a
 * quarter-final could not say it was a quarter-final. `round_label` keeps the
 * string; these make sure it is the one that wins.
 */

function preMatch(roundLabel: string | null, matchday: number | null) {
  return {
    kickoffAt: "2026-08-15T15:00:00.000Z",
    status: "scheduled" as const,
    competitionName: null,
    venueName: null,
    venueCity: null,
    referee: null,
    roundLabel,
    matchday,
  };
}

describe("roundText", () => {
  it("names a knockout round, which a number never could", () => {
    expect(roundText(preMatch("Quarter-finals", null))).toBe("Quarter-finals");
    expect(roundText(preMatch("Round of 16", null))).toBe("Round of 16");
    expect(roundText(preMatch("Semi-finals", null))).toBe("Semi-finals");
  });

  it("rewrites the provider's machine-shaped league label", () => {
    // "Regular Season - 12" is not how anyone says it out loud.
    expect(roundText(preMatch("Regular Season - 12", 12))).toBe("Matchday 12");
    expect(roundText(preMatch("regular season - 3", 3))).toBe("Matchday 3");
  });

  it("passes every other label through untouched", () => {
    // Narrow on purpose: a rewrite that tried to prettify arbitrary labels
    // would eventually mangle a real round name.
    expect(roundText(preMatch("Group Stage - 2", null))).toBe("Group Stage - 2");
    expect(roundText(preMatch("Regular Season - 12 (replay)", null))).toBe("Regular Season - 12 (replay)");
    expect(roundText(preMatch("Final", null))).toBe("Final");
  });

  it("falls back to the number for a fixture synced before the label existed", () => {
    // Every fixture already in the database has a null round_label and, for a
    // league game, a real matchday. Those must not lose the round they had.
    expect(roundText(preMatch(null, 7))).toBe("Matchday 7");
  });

  it("says nothing when KIVO holds neither", () => {
    // Null renders no row at all. A "Round" line reading "Unknown" would be a
    // claim about the match rather than about the data.
    expect(roundText(preMatch(null, null))).toBeNull();
    expect(roundText(preMatch("   ", null))).toBeNull();
  });

  it("prefers the label over the number when both exist", () => {
    // The label is what the competition calls the round; the number is derived
    // from it. If they ever disagree, the source wins.
    expect(roundText(preMatch("Quarter-finals", 4))).toBe("Quarter-finals");
  });
});
