import { describe, expect, it } from "vitest";
import { parseMatchday } from "./matchday";

describe("parseMatchday", () => {
  it("reads the number out of a numbered league round", () => {
    expect(parseMatchday("Regular Season - 1")).toBe(1);
    expect(parseMatchday("Regular Season - 12")).toBe(12);
    expect(parseMatchday("Regular Season - 38")).toBe(38);
    expect(parseMatchday("Group Stage - 2")).toBe(2);
  });

  it("reads the other label shapes providers use", () => {
    expect(parseMatchday("Matchday 7")).toBe(7);
    expect(parseMatchday("Gameweek 21")).toBe(21);
    expect(parseMatchday("Round 3")).toBe(3);
    expect(parseMatchday("Jornada 15")).toBe(15);
    expect(parseMatchday("Spieltag 9")).toBe(9);
  });

  it("refuses to invent a matchday for a knockout round", () => {
    // The whole point of the module. Numbering these 1..N would fabricate an
    // ordering the competition does not have.
    expect(parseMatchday("Quarter-finals")).toBeNull();
    expect(parseMatchday("Semi-finals")).toBeNull();
    expect(parseMatchday("Final")).toBeNull();
    expect(parseMatchday("3rd Place Final")).toBeNull();
  });

  it('never reads "Round of 16" as matchday 16 — a count of teams, not a matchday', () => {
    expect(parseMatchday("Round of 16")).toBeNull();
    expect(parseMatchday("Round of 32")).toBeNull();
    expect(parseMatchday("Last 16")).toBeNull();
  });

  it("returns null for missing, empty and unparseable input rather than a default", () => {
    expect(parseMatchday(null)).toBeNull();
    expect(parseMatchday(undefined)).toBeNull();
    expect(parseMatchday("")).toBeNull();
    expect(parseMatchday("   ")).toBeNull();
    expect(parseMatchday("Preliminary Round")).toBeNull();
    // Ambiguous on its own: a provider that changed format must not be guessed at.
    expect(parseMatchday("12")).toBeNull();
  });

  it("rejects a number outside any real competition's range", () => {
    expect(parseMatchday("Regular Season - 0")).toBeNull();
    expect(parseMatchday("Regular Season - 900")).toBeNull();
  });
});
