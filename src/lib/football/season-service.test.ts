import { describe, expect, it } from "vitest";
import {
  approximateSeasonRange,
  isSingleYearSeason,
  seasonLabel,
  seasonPosition,
  seasonWindow,
  seasonYearForDate,
} from "./season-service";

/**
 * The founder's instruction was explicit: "Do not hardcode 2024 or 2025. The
 * system must transition automatically as new seasons begin."
 *
 * So every test below moves time rather than asserting a literal year. If one
 * of these ever needs a year written into it to pass, the implementation has
 * grown a hardcoded season and the test is the thing that noticed.
 */

const JULY_2026 = new Date("2026-07-01T00:00:00.000Z");
const JUNE_2026 = new Date("2026-06-30T23:59:59.000Z");
const MARCH_2027 = new Date("2027-03-15T12:00:00.000Z");

describe("seasonWindow", () => {
  it("gives previous, current and upcoming around whatever today is", () => {
    const window = seasonWindow(JULY_2026);
    expect(window.previous.seasonYear).toBe(2025);
    expect(window.current.seasonYear).toBe(2026);
    expect(window.upcoming.seasonYear).toBe(2027);
  });

  it("rolls over on 1 July, the same boundary the fetched season uses", () => {
    // These two instants are one second apart and belong to different seasons.
    // If this boundary ever disagreed with currentProviderSeason's, every day
    // in July would be FETCHED as one season and LABELLED as another — the
    // least debuggable off-by-one available.
    expect(seasonWindow(JUNE_2026).current.seasonYear).toBe(2025);
    expect(seasonWindow(JULY_2026).current.seasonYear).toBe(2026);
  });

  it("still calls the season under way 'current' in March", () => {
    // Mid-season. A fan in March is watching 2026/27, not waiting for it.
    expect(seasonWindow(MARCH_2027).current.seasonYear).toBe(2026);
    expect(seasonWindow(MARCH_2027).upcoming.seasonYear).toBe(2027);
  });
});

describe("seasonLabel", () => {
  it("writes a European season the way football writes it", () => {
    expect(seasonLabel(2026)).toBe("2026/27");
    expect(seasonLabel(2019)).toBe("2019/20");
  });

  it("pads the second half to two digits", () => {
    // 2009/10, never 2009/1.
    expect(seasonLabel(2009)).toBe("2009/10");
  });

  it("survives the century rollover", () => {
    // "2099/00" is correct; string-slicing the year would give "2099/0".
    expect(seasonLabel(2099)).toBe("2099/00");
  });

  it("writes a single-year season as one year", () => {
    // MLS, J1, the Scandinavian leagues. Printing "2026/27" for a competition
    // that finishes in November is simply wrong.
    expect(seasonLabel(2026, { startsOn: "2026-02-21", endsOn: "2026-11-09" })).toBe("2026");
  });

  it("falls back to the European form when the dates are missing or unusable", () => {
    // The fallback is a LABEL, not a fetch — being wrong here misprints a
    // string, where being wrong about a fetched season returns another
    // season's data and looks entirely normal.
    expect(seasonLabel(2026, {})).toBe("2026/27");
    expect(seasonLabel(2026, { startsOn: "not a date", endsOn: "2026-11-09" })).toBe("2026/27");
    expect(seasonLabel(2026, { startsOn: "2026-08-01", endsOn: null })).toBe("2026/27");
  });
});

describe("isSingleYearSeason", () => {
  it("is true only when real dates show one calendar year", () => {
    expect(isSingleYearSeason({ startsOn: "2026-02-21", endsOn: "2026-11-09" })).toBe(true);
    expect(isSingleYearSeason({ startsOn: "2026-08-15", endsOn: "2027-05-24" })).toBe(false);
  });

  it("answers false when it has nothing to go on, rather than guessing", () => {
    expect(isSingleYearSeason({})).toBe(false);
    expect(isSingleYearSeason({ startsOn: null, endsOn: null })).toBe(false);
  });
});

describe("seasonPosition", () => {
  it("places a year either side of today", () => {
    expect(seasonPosition(2027, JULY_2026)).toBe("upcoming");
    expect(seasonPosition(2026, JULY_2026)).toBe("current");
    expect(seasonPosition(2025, JULY_2026)).toBe("previous");
  });

  it("calls a long-past season previous rather than inventing a fourth bucket", () => {
    // A caller that cares how far back it is has the number and can subtract.
    expect(seasonPosition(1998, JULY_2026)).toBe("previous");
  });
});

describe("approximateSeasonRange", () => {
  it("spans a full year from the season boundary", () => {
    const range = approximateSeasonRange(2026);
    expect(range.startsOn).toBe("2026-07-01");
    expect(range.endsOn).toBe("2027-06-30");
  });

  it("is generous rather than tight, on purpose", () => {
    // The failure modes are asymmetric: too wide catches a pre-season friendly
    // that arguably belongs to the season anyway; too narrow silently drops a
    // real fixture, and a missing fixture is indistinguishable from one that
    // was never played.
    const range = approximateSeasonRange(2026);
    expect(new Date(range.startsOn).getTime()).toBeLessThan(new Date("2026-08-15").getTime());
    expect(new Date(range.endsOn).getTime()).toBeGreaterThan(new Date("2027-05-24").getTime());
  });

  it("handles a leap year without losing or gaining a day", () => {
    expect(approximateSeasonRange(2027).endsOn).toBe("2028-06-30");
  });
});

describe("seasonYearForDate", () => {
  it("files a fixture with no stated season under the right one", () => {
    // Date-scoped provider endpoints answer "what is on today" and mention no
    // season at all, so the kickoff is the only thing to file it by.
    expect(seasonYearForDate(new Date("2026-08-19T20:00:00.000Z"))).toBe(2026);
    expect(seasonYearForDate(new Date("2027-05-24T15:00:00.000Z"))).toBe(2026);
    expect(seasonYearForDate(new Date("2027-07-02T15:00:00.000Z"))).toBe(2027);
  });
});
