import { describe, expect, it } from "vitest";
import {
  FANTASY_BUDGET_CAP,
  formatDeadlineCountdown,
  positionGroup,
  type RosterPick,
  validateRoster,
} from "./fantasy-rules";

/**
 * Builds a legal 15-player squad in the 1-4-4-2 formation:
 *   GK: 1 starting, 1 bench   (2 total)
 *   DEF: 4 starting, 1 bench  (5 total)
 *   MID: 4 starting, 1 bench  (5 total)
 *   FWD: 2 starting, 1 bench  (3 total)
 * Total starting XI = 1 + 4 + 4 + 2 = 11. Every pick defaults to the flat
 * DEFAULT_FANTASY_PRICE-equivalent of 5.0, for a total cost of 75.0 — safely
 * under the 100.0 budget cap so tests can push cost right up to the boundary.
 */
function buildValidSquad(): RosterPick[] {
  const picks: RosterPick[] = [];
  let id = 0;
  const add = (positionGroup: RosterPick["positionGroup"], count: number, startingCount: number, price = 5.0) => {
    for (let i = 0; i < count; i++) {
      picks.push({
        playerId: `p${id++}`,
        positionGroup,
        price,
        isStarting: i < startingCount,
      });
    }
  };
  add("Goalkeepers", 2, 1);
  add("Defenders", 5, 4);
  add("Midfielders", 5, 4);
  add("Forwards", 3, 2);
  return picks;
}

describe("validateRoster", () => {
  it("accepts a valid, legally-shaped squad", () => {
    expect(validateRoster(buildValidSquad())).toEqual({ ok: true });
  });

  describe("squad size", () => {
    it("rejects too few players", () => {
      const picks = buildValidSquad().slice(0, 14);
      expect(validateRoster(picks)).toEqual({
        ok: false,
        error: "Your squad needs exactly 15 players (you have 14).",
      });
    });

    it("rejects too many players", () => {
      const picks = buildValidSquad();
      picks.push({ playerId: "extra", positionGroup: "Forwards", price: 0, isStarting: false });
      expect(validateRoster(picks)).toEqual({
        ok: false,
        error: "Your squad needs exactly 15 players (you have 16).",
      });
    });

    it("rejects an empty squad", () => {
      expect(validateRoster([])).toEqual({
        ok: false,
        error: "Your squad needs exactly 15 players (you have 0).",
      });
    });
  });

  it("rejects a duplicate player appearing twice", () => {
    const picks = buildValidSquad();
    // Overwrite the last player's id with the first player's id, keeping length at 15.
    picks[14] = { ...picks[14], playerId: picks[0].playerId };
    expect(validateRoster(picks)).toEqual({
      ok: false,
      error: "Each player can only appear once in your squad.",
    });
  });

  it("rejects a pick with an unrecognised position", () => {
    const picks = buildValidSquad();
    picks[0] = { ...picks[0], positionGroup: "Other" };
    expect(validateRoster(picks)).toEqual({
      ok: false,
      error: "One of your picks doesn't have a recognised position yet. Try a different player.",
    });
  });

  describe("position quotas", () => {
    it("rejects a squad with too few goalkeepers (checked first)", () => {
      // GK 1 (short), DEF 6 (over) to keep total at 15.
      const picks: RosterPick[] = [];
      let id = 0;
      const add = (group: RosterPick["positionGroup"], count: number, startingCount: number) => {
        for (let i = 0; i < count; i++) {
          picks.push({ playerId: `p${id++}`, positionGroup: group, price: 5.0, isStarting: i < startingCount });
        }
      };
      add("Goalkeepers", 1, 1);
      add("Defenders", 6, 4);
      add("Midfielders", 5, 4);
      add("Forwards", 3, 2);
      expect(validateRoster(picks)).toEqual({
        ok: false,
        error: "Your squad needs exactly 2 goalkeepers (you have 1).",
      });
    });

    it("rejects a squad with too many defenders (goalkeepers correct)", () => {
      const picks: RosterPick[] = [];
      let id = 0;
      const add = (group: RosterPick["positionGroup"], count: number, startingCount: number) => {
        for (let i = 0; i < count; i++) {
          picks.push({ playerId: `p${id++}`, positionGroup: group, price: 5.0, isStarting: i < startingCount });
        }
      };
      add("Goalkeepers", 2, 1);
      add("Defenders", 6, 4);
      add("Midfielders", 4, 4);
      add("Forwards", 3, 2);
      expect(validateRoster(picks)).toEqual({
        ok: false,
        error: "Your squad needs exactly 5 defenders (you have 6).",
      });
    });

    it("rejects a squad with too few midfielders (GK/DEF correct)", () => {
      const picks: RosterPick[] = [];
      let id = 0;
      const add = (group: RosterPick["positionGroup"], count: number, startingCount: number) => {
        for (let i = 0; i < count; i++) {
          picks.push({ playerId: `p${id++}`, positionGroup: group, price: 5.0, isStarting: i < startingCount });
        }
      };
      add("Goalkeepers", 2, 1);
      add("Defenders", 5, 4);
      add("Midfielders", 4, 4);
      add("Forwards", 4, 2);
      expect(validateRoster(picks)).toEqual({
        ok: false,
        error: "Your squad needs exactly 5 midfielders (you have 4).",
      });
    });
  });

  describe("budget cap", () => {
    it("accepts a squad costing exactly the budget cap", () => {
      const picks = buildValidSquad();
      // 15 players; set 14 of them to 0 cost and the last to the full cap so
      // total cost lands exactly on FANTASY_BUDGET_CAP.
      for (let i = 0; i < picks.length - 1; i++) picks[i] = { ...picks[i], price: 0 };
      picks[picks.length - 1] = { ...picks[picks.length - 1], price: FANTASY_BUDGET_CAP };
      expect(validateRoster(picks)).toEqual({ ok: true });
    });

    it("accepts a squad a hair over the cap within floating-point tolerance", () => {
      const picks = buildValidSquad();
      for (let i = 0; i < picks.length - 1; i++) picks[i] = { ...picks[i], price: 0 };
      picks[picks.length - 1] = { ...picks[picks.length - 1], price: FANTASY_BUDGET_CAP + 5e-10 };
      expect(validateRoster(picks)).toEqual({ ok: true });
    });

    it("rejects a squad over the cap beyond floating-point tolerance", () => {
      const picks = buildValidSquad();
      for (let i = 0; i < picks.length - 1; i++) picks[i] = { ...picks[i], price: 0 };
      picks[picks.length - 1] = { ...picks[picks.length - 1], price: FANTASY_BUDGET_CAP + 1e-8 };
      const result = validateRoster(picks);
      expect(result.ok).toBe(false);
    });

    it("rejects a squad clearly over the budget cap", () => {
      const picks = buildValidSquad().map((p) => ({ ...p, price: 10 })); // 15 * 10 = 150
      expect(validateRoster(picks)).toEqual({
        ok: false,
        error: "Your squad costs £150.0m, over the £100.0m budget.",
      });
    });
  });

  describe("starting XI size", () => {
    it("rejects fewer than 11 starters", () => {
      const picks = buildValidSquad();
      // Flip one starting defender to bench -> startingCount = 10.
      const idx = picks.findIndex((p) => p.positionGroup === "Defenders" && p.isStarting);
      picks[idx] = { ...picks[idx], isStarting: false };
      expect(validateRoster(picks)).toEqual({
        ok: false,
        error: "Your starting XI needs exactly 11 players (you have 10).",
      });
    });

    it("rejects more than 11 starters", () => {
      const picks = buildValidSquad();
      // Flip the bench defender to starting -> startingCount = 12.
      const idx = picks.findIndex((p) => p.positionGroup === "Defenders" && !p.isStarting);
      picks[idx] = { ...picks[idx], isStarting: true };
      expect(validateRoster(picks)).toEqual({
        ok: false,
        error: "Your starting XI needs exactly 11 players (you have 12).",
      });
    });
  });

  describe("starting XI formation rules", () => {
    function buildFormation(startGK: number, startDEF: number, startMID: number, startFWD: number): RosterPick[] {
      const picks: RosterPick[] = [];
      let id = 0;
      const add = (group: RosterPick["positionGroup"], total: number, starting: number) => {
        for (let i = 0; i < total; i++) {
          picks.push({ playerId: `p${id++}`, positionGroup: group, price: 5.0, isStarting: i < starting });
        }
      };
      add("Goalkeepers", 2, startGK);
      add("Defenders", 5, startDEF);
      add("Midfielders", 5, startMID);
      add("Forwards", 3, startFWD);
      return picks;
    }

    it("rejects zero starting goalkeepers", () => {
      // 0 GK + 5 DEF + 4 MID + 2 FWD = 11
      const result = validateRoster(buildFormation(0, 5, 4, 2));
      expect(result).toEqual({
        ok: false,
        error: "Your starting XI needs exactly 1 goalkeepers (you have 0).",
      });
    });

    it("rejects two starting goalkeepers", () => {
      // 2 GK + 4 DEF + 3 MID + 2 FWD = 11
      const result = validateRoster(buildFormation(2, 4, 3, 2));
      expect(result).toEqual({
        ok: false,
        error: "Your starting XI needs exactly 1 goalkeepers (you have 2).",
      });
    });

    it("accepts exactly 1 starting goalkeeper (boundary)", () => {
      const result = validateRoster(buildFormation(1, 4, 4, 2));
      expect(result).toEqual({ ok: true });
    });

    it("rejects fewer than 3 starting defenders", () => {
      // 1 GK + 2 DEF + 5 MID + 3 FWD = 11
      const result = validateRoster(buildFormation(1, 2, 5, 3));
      expect(result).toEqual({
        ok: false,
        error: "Your starting XI needs between 3 and 5 defenders (you have 2).",
      });
    });

    it("accepts exactly 3 starting defenders (lower boundary)", () => {
      // 1 GK + 3 DEF + 5 MID + 2 FWD = 11
      const result = validateRoster(buildFormation(1, 3, 5, 2));
      expect(result).toEqual({ ok: true });
    });

    it("accepts exactly 5 starting defenders (upper boundary)", () => {
      // 1 GK + 5 DEF + 3 MID + 2 FWD = 11
      const result = validateRoster(buildFormation(1, 5, 3, 2));
      expect(result).toEqual({ ok: true });
    });

    it("rejects fewer than 2 starting midfielders", () => {
      // 1 GK + 5 DEF + 1 MID + 3 FWD (wait, need DEF<=5) -> 1+5+1+3=10, adjust FWD to reach 11 impossible since FWD max total 3.
      // Use 1 GK + 4 DEF + 1 MID + 3 FWD = 9, still short; instead reduce DEF to raise total via FWD cap.
      // 1 GK + 5 DEF + 1 MID + 3 FWD = 10 (short of 11) is fine to still exercise MID's own branch since
      // the starting-count-!=11 check runs before the per-group loop... use a combination totalling 11:
      // 1 GK + 5 DEF + 1 MID + ... need total 11 => FWD = 11-1-5-1 = 4, but FWD max total is 3. Instead
      // drop DEF to 4: 1 + 4 + 1 + 3(FWD max) = 9, still short. Drop DEF further won't help (need MORE not less).
      // The only way to reach total 11 with MID=1 is DEF=1+3+FWD i.e. maximize DEF(5) and FWD(3): 1+5+1+3=10 (< 11).
      // So MID=1 caps total starters at 10 given DEF<=5, FWD<=3, GK=1 -> starting-count check fires first.
      const picks = buildFormation(1, 5, 1, 3); // total starters = 10
      const result = validateRoster(picks);
      expect(result).toEqual({
        ok: false,
        error: "Your starting XI needs exactly 11 players (you have 10).",
      });
    });

    it("accepts exactly 2 starting midfielders (lower boundary)", () => {
      const result = validateRoster(buildFormation(1, 5, 2, 3));
      expect(result).toEqual({ ok: true });
    });

    it("accepts exactly 5 starting midfielders (upper boundary)", () => {
      // 1 GK + 3 DEF + 5 MID + 2 FWD = 11
      const result = validateRoster(buildFormation(1, 3, 5, 2));
      expect(result).toEqual({ ok: true });
    });

    it("rejects zero starting forwards", () => {
      // 1 GK + 5 DEF + 5 MID + 0 FWD = 11
      const result = validateRoster(buildFormation(1, 5, 5, 0));
      expect(result).toEqual({
        ok: false,
        error: "Your starting XI needs between 1 and 3 forwards (you have 0).",
      });
    });

    it("accepts exactly 1 starting forward (lower boundary)", () => {
      // 1 GK + 5 DEF + 4 MID + 1 FWD = 11
      const result = validateRoster(buildFormation(1, 5, 4, 1));
      expect(result).toEqual({ ok: true });
    });

    it("accepts exactly 3 starting forwards (upper boundary)", () => {
      // 1 GK + 4 DEF + 3 MID + 3 FWD = 11
      const result = validateRoster(buildFormation(1, 4, 3, 3));
      expect(result).toEqual({ ok: true });
    });
  });
});

describe("positionGroup", () => {
  it("returns Other for null/empty position", () => {
    expect(positionGroup(null)).toBe("Other");
    expect(positionGroup("")).toBe("Other");
  });

  it.each([
    ["Goalkeeper", "Goalkeepers"],
    ["goalkeeper", "Goalkeepers"],
    ["GK", "Goalkeepers"],
    ["Defender", "Defenders"],
    ["Centre-Back", "Defenders"],
    ["Left-Back", "Defenders"],
    ["DF", "Defenders"],
    ["Midfielder", "Midfielders"],
    ["Attacking Midfield", "Midfielders"],
    ["MF", "Midfielders"],
    ["Forward", "Forwards"],
    ["Striker", "Forwards"],
    ["Winger", "Forwards"],
    ["FW", "Forwards"],
    ["ST", "Forwards"],
  ] as const)("maps %s to %s", (input, expected) => {
    expect(positionGroup(input)).toBe(expected);
  });

  it("returns Other for an unrecognised position string", () => {
    expect(positionGroup("Utility Player")).toBe("Other");
  });
});

describe("formatDeadlineCountdown", () => {
  const now = new Date("2026-08-14T12:00:00.000Z");

  it("formats a countdown of multiple days and hours", () => {
    const deadline = new Date(now.getTime() + 2 * 86_400_000 + 3 * 3_600_000).toISOString();
    expect(formatDeadlineCountdown(deadline, now)).toBe("2d 3h");
  });

  it("formats a countdown of hours and minutes when under a day", () => {
    const deadline = new Date(now.getTime() + 5 * 3_600_000 + 30 * 60_000).toISOString();
    expect(formatDeadlineCountdown(deadline, now)).toBe("5h 30m");
  });

  it("formats a countdown of minutes only when under an hour", () => {
    const deadline = new Date(now.getTime() + 45 * 60_000).toISOString();
    expect(formatDeadlineCountdown(deadline, now)).toBe("45m");
  });

  it("returns 'Deadline passed' when the deadline is exactly now", () => {
    expect(formatDeadlineCountdown(now.toISOString(), now)).toBe("Deadline passed");
  });

  it("returns 'Deadline passed' when the deadline is in the past", () => {
    const deadline = new Date(now.getTime() - 60_000).toISOString();
    expect(formatDeadlineCountdown(deadline, now)).toBe("Deadline passed");
  });

  it("handles the exact 1-day boundary", () => {
    const deadline = new Date(now.getTime() + 86_400_000).toISOString();
    expect(formatDeadlineCountdown(deadline, now)).toBe("1d 0h");
  });

  it("handles the exact 1-hour boundary", () => {
    const deadline = new Date(now.getTime() + 3_600_000).toISOString();
    expect(formatDeadlineCountdown(deadline, now)).toBe("1h 0m");
  });

  it("floors sub-minute remainders to 0m", () => {
    const deadline = new Date(now.getTime() + 59_999).toISOString();
    expect(formatDeadlineCountdown(deadline, now)).toBe("0m");
  });
});
