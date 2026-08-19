import { describe, expect, it } from "vitest";
import { classifyStandingsZone, standingsZoneLegend } from "./standings-zones";

describe("classifyStandingsZone", () => {
  it("returns null when the competition stated nothing", () => {
    // The common case. Most rows in most tables carry no description, and the
    // table must draw nothing at all for them — a neutral chip on a mid-table
    // row asserts safety the competition never claimed.
    expect(classifyStandingsZone(null)).toBeNull();
    expect(classifyStandingsZone(undefined)).toBeNull();
    expect(classifyStandingsZone("   ")).toBeNull();
  });

  it("reads continental qualification as continental, not as promotion", () => {
    // "Promotion - Champions League (Group Stage)" contains the word
    // promotion and is not one. Getting this wrong would paint every
    // Champions League place in the promotion colour.
    expect(classifyStandingsZone("Promotion - Champions League (Group Stage)")?.kind).toBe("champions");
    expect(classifyStandingsZone("Promotion - Champions League (Qualification)")?.kind).toBe("champions");
    expect(classifyStandingsZone("Copa Libertadores")?.kind).toBe("champions");
  });

  it("separates the secondary continental competitions from the top one", () => {
    expect(classifyStandingsZone("Promotion - Europa League (Group Stage)")?.kind).toBe("europe");
    expect(classifyStandingsZone("Promotion - Europa Conference League (Qualification)")?.kind).toBe("europe");
    expect(classifyStandingsZone("Copa Sudamericana")?.kind).toBe("europe");
  });

  it("treats a play-off place as a play-off, not as the outcome it might lead to", () => {
    // Nobody has gone up or down from a play-off place. Colouring 3rd in the
    // Championship as promotion, or 16th in the Bundesliga as relegation,
    // states an outcome that has not happened.
    expect(classifyStandingsZone("Promotion - Championship Play-offs")?.kind).toBe("playoff");
    expect(classifyStandingsZone("Relegation Play-off")?.kind).toBe("playoff");
    expect(classifyStandingsZone("Relegation Round")?.kind).toBe("playoff");
  });

  it("classifies unconditional promotion and relegation", () => {
    expect(classifyStandingsZone("Promotion - Premier League")?.kind).toBe("promotion");
    expect(classifyStandingsZone("Relegation - Championship")?.kind).toBe("relegation");
    expect(classifyStandingsZone("Relegation - Ligue 2")?.kind).toBe("relegation");
  });

  it("keeps a description it cannot classify rather than dropping it", () => {
    // The sentence is true whether or not KIVO recognises it. `other` means
    // "no colour", never "no zone" — the legend still carries the words.
    const zone = classifyStandingsZone("Qualification for the National Play-in");
    expect(zone).not.toBeNull();
    expect(zone?.label).toBe("Qualification for the National Play-in");
  });

  it("never rewrites the competition's own words", () => {
    const label = "Promotion - Champions League (Group Stage)";
    expect(classifyStandingsZone(`  ${label}  `)?.label).toBe(label);
  });
});

describe("standingsZoneLegend", () => {
  it("lists each distinct description once, in the order it first appears", () => {
    const legend = standingsZoneLegend([
      classifyStandingsZone("Promotion - Champions League (Group Stage)"),
      classifyStandingsZone("Promotion - Champions League (Group Stage)"),
      null,
      classifyStandingsZone("Promotion - Europa League (Group Stage)"),
      null,
      classifyStandingsZone("Relegation - Championship"),
    ]);
    expect(legend.map((zone) => zone.label)).toEqual([
      "Promotion - Champions League (Group Stage)",
      "Promotion - Europa League (Group Stage)",
      "Relegation - Championship",
    ]);
  });

  it("keys on the exact label, so two Champions League lines stay two lines", () => {
    // A group-stage place and a qualifying-round place are different
    // destinations. Collapsing them by kind would lose the distinction the
    // competition drew.
    const legend = standingsZoneLegend([
      classifyStandingsZone("Promotion - Champions League (Group Stage)"),
      classifyStandingsZone("Promotion - Champions League (Qualification)"),
    ]);
    expect(legend).toHaveLength(2);
  });

  it("is empty when no row carried a description", () => {
    expect(standingsZoneLegend([null, null, null])).toEqual([]);
  });
});
