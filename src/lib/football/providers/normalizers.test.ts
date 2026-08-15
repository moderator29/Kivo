import { describe, expect, it } from "vitest";
import { mapEventType, mapStatus, mapTransferType } from "./normalizers";

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
