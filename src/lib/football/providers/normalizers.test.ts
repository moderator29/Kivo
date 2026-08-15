import { describe, expect, it } from "vitest";
import { mapEventType, mapFixtureStatistics, mapStatus, mapTransferType } from "./normalizers";

describe("mapStatus", () => {
  it.each([
    ["1H", "live"],
    ["2H", "live"],
    ["ET", "live"],
    ["P", "live"],
    ["LIVE", "live"],
    ["BT", "live"],
    ["HT", "halftime"],
    ["FT", "finished"],
    ["AET", "finished"],
    ["PEN", "finished"],
    ["PST", "postponed"],
    ["ABD", "abandoned"],
    ["CANC", "cancelled"],
    ["AWD", "cancelled"],
    ["WO", "cancelled"],
    ["NS", "scheduled"],
  ] as const)("maps %s to %s", (input, expected) => {
    expect(mapStatus(input)).toBe(expected);
  });

  it("falls back to unknown for an unrecognised status code", () => {
    expect(mapStatus("TBD")).toBe("unknown");
    expect(mapStatus("")).toBe("unknown");
  });

  it("is case-sensitive to provider codes (lowercase input is not recognised)", () => {
    // API-Football always sends uppercase short codes; a lowercase variant should
    // not silently match and must fall through to "unknown".
    expect(mapStatus("ns")).toBe("unknown");
  });
});

describe("mapEventType", () => {
  it("maps a plain goal", () => {
    expect(mapEventType("Goal", "Normal Goal")).toBe("goal");
  });

  it("maps an own goal", () => {
    expect(mapEventType("Goal", "Own Goal")).toBe("own_goal");
  });

  it("maps a missed penalty", () => {
    expect(mapEventType("Goal", "Missed Penalty")).toBe("penalty_missed");
  });

  it("maps a scored penalty", () => {
    expect(mapEventType("Goal", "Penalty")).toBe("penalty_goal");
  });

  it("maps a yellow card", () => {
    expect(mapEventType("Card", "Yellow Card")).toBe("yellow_card");
  });

  it("maps a second yellow card", () => {
    expect(mapEventType("Card", "Second Yellow card")).toBe("second_yellow_card");
  });

  it("maps a red card", () => {
    expect(mapEventType("Card", "Red Card")).toBe("red_card");
  });

  it("falls back to unknown for an unrecognised card detail", () => {
    expect(mapEventType("Card", "Sin Bin")).toBe("unknown");
  });

  it("maps a substitution", () => {
    expect(mapEventType("subst", "Substitution 1")).toBe("substitution");
  });

  it("maps a VAR review", () => {
    expect(mapEventType("Var", "Goal Disallowed - Offside")).toBe("var_review");
  });

  it("falls back to unknown for an unrecognised type", () => {
    expect(mapEventType("Something Else", "n/a")).toBe("unknown");
  });

  it("is case-insensitive on both type and detail", () => {
    expect(mapEventType("GOAL", "OWN GOAL")).toBe("own_goal");
    expect(mapEventType("card", "yellow card")).toBe("yellow_card");
  });
});

describe("mapTransferType", () => {
  it("returns unknown for null", () => {
    expect(mapTransferType(null)).toBe("unknown");
  });

  it("returns unknown for an empty string", () => {
    expect(mapTransferType("")).toBe("unknown");
  });

  it("returns unknown for whitespace-only text", () => {
    expect(mapTransferType("   ")).toBe("unknown");
  });

  it("returns unknown for 'N/A' (case-insensitive)", () => {
    expect(mapTransferType("N/A")).toBe("unknown");
    expect(mapTransferType("n/a")).toBe("unknown");
  });

  it("returns free for a free transfer", () => {
    expect(mapTransferType("Free")).toBe("free");
  });

  it("returns loan for a loan move", () => {
    expect(mapTransferType("Loan")).toBe("loan");
  });

  it("returns end_of_loan for an end-of-loan return, not loan", () => {
    expect(mapTransferType("End of Loan")).toBe("end_of_loan");
  });

  it("returns transfer for a fee expressed in euros", () => {
    expect(mapTransferType("€45M")).toBe("transfer");
  });

  it("returns transfer for a fee expressed in dollars", () => {
    expect(mapTransferType("$20M")).toBe("transfer");
  });

  it("returns transfer for a plain numeric fee", () => {
    expect(mapTransferType("45000000")).toBe("transfer");
  });

  it("returns unknown for free text that matches no known bucket", () => {
    expect(mapTransferType("Undisclosed")).toBe("unknown");
  });
});

describe("mapFixtureStatistics", () => {
  it("maps a full, real-shaped statistics array onto every field", () => {
    expect(
      mapFixtureStatistics([
        { type: "Shots on Goal", value: 6 },
        { type: "Shots off Goal", value: 4 },
        { type: "Total Shots", value: 13 },
        { type: "Blocked Shots", value: 3 },
        { type: "Shots insidebox", value: 8 },
        { type: "Shots outsidebox", value: 5 },
        { type: "Fouls", value: 11 },
        { type: "Corner Kicks", value: 6 },
        { type: "Offsides", value: 2 },
        { type: "Ball Possession", value: "56%" },
        { type: "Yellow Cards", value: 3 },
        { type: "Red Cards", value: null },
        { type: "Goalkeeper Saves", value: 2 },
        { type: "Total passes", value: 512 },
        { type: "Passes accurate", value: 431 },
        { type: "Passes %", value: "84%" },
        { type: "expected_goals", value: "1.87" },
      ]),
    ).toEqual({
      shotsTotal: 13,
      shotsOnTarget: 6,
      shotsOffTarget: 4,
      shotsBlocked: 3,
      shotsInsideBox: 8,
      shotsOutsideBox: 5,
      fouls: 11,
      corners: 6,
      offsides: 2,
      possessionPct: 56,
      yellowCards: 3,
      redCards: null,
      saves: 2,
      passesTotal: 512,
      passesAccurate: 431,
      passesPct: 84,
      expectedGoals: 1.87,
    });
  });

  it("is case-insensitive on the type label", () => {
    expect(mapFixtureStatistics([{ type: "BALL POSSESSION", value: "40%" }]).possessionPct).toBe(40);
  });

  it("returns null for every field when given an empty array", () => {
    const result = mapFixtureStatistics([]);
    expect(Object.values(result).every((v) => v === null)).toBe(true);
  });

  it("drops a type it doesn't recognise instead of guessing", () => {
    const result = mapFixtureStatistics([{ type: "Some New Stat API-Football Adds Later", value: 99 }]);
    expect(Object.values(result).every((v) => v === null)).toBe(true);
  });

  it("treats an empty string value as null, not zero", () => {
    expect(mapFixtureStatistics([{ type: "Fouls", value: "" }]).fouls).toBeNull();
  });

  it("treats non-numeric text as null", () => {
    expect(mapFixtureStatistics([{ type: "Fouls", value: "N/A" }]).fouls).toBeNull();
  });
});
