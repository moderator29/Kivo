import { describe, expect, it } from "vitest";
import { buildTransferSummary } from "./transfer-notifications";

const base = {
  transferId: "t1",
  playerId: "p1",
  playerName: "Ademola Lookman",
  fromTeamId: null,
  fromTeamName: null,
  toTeamId: null,
  toTeamName: null,
};

describe("buildTransferSummary", () => {
  it("names both ends when KIVO resolved both", () => {
    expect(
      buildTransferSummary({ ...base, fromTeamName: "Atalanta", toTeamName: "Internazionale" }),
    ).toBe("Ademola Lookman has moved from Atalanta to Internazionale");
  });

  it("says only what it knows when one end is unresolved", () => {
    expect(buildTransferSummary({ ...base, toTeamName: "Internazionale" })).toBe(
      "Ademola Lookman has signed for Internazionale",
    );
    expect(buildTransferSummary({ ...base, fromTeamName: "Atalanta" })).toBe(
      "Ademola Lookman has left Atalanta",
    );
  });

  it("never invents a club name for an end it could not resolve", () => {
    const summary = buildTransferSummary(base);
    expect(summary).toBe("Ademola Lookman has a new transfer on record");
    expect(summary.toLowerCase()).not.toContain("unknown");
  });
});
