import { describe, expect, it } from "vitest";
import {
  hasTeamStatistics,
  summarizeTeamStatistics,
  type TeamMatchStatisticsRow,
} from "@/components/teams/team-statistics";

const EMPTY: TeamMatchStatisticsRow = {
  possession_pct: null,
  shots_total: null,
  shots_on_target: null,
  passes_total: null,
  passes_accurate: null,
  corners: null,
  fouls: null,
  expected_goals: null,
};

function row(partial: Partial<TeamMatchStatisticsRow>): TeamMatchStatisticsRow {
  return { ...EMPTY, ...partial };
}

describe("summarizeTeamStatistics", () => {
  it("returns nothing at all for no rows", () => {
    const summary = summarizeTeamStatistics([]);
    expect(summary.matchesWithStatistics).toBe(0);
    expect(summary.possession).toBeNull();
    expect(hasTeamStatistics(summary)).toBe(false);
  });

  it("treats an all-null row as no statistics rather than zeroes", () => {
    const summary = summarizeTeamStatistics([row({}), row({})]);
    expect(summary.matchesWithStatistics).toBe(0);
    expect(summary.shotsPerMatch).toBeNull();
    expect(hasTeamStatistics(summary)).toBe(false);
  });

  it("averages only the matches that reported the metric, and says how many", () => {
    const summary = summarizeTeamStatistics([
      row({ possession_pct: 60 }),
      row({ possession_pct: 50 }),
      row({ shots_total: 10 }),
    ]);
    expect(summary.possession).toEqual({ value: 55, sample: 2 });
    expect(summary.shotsPerMatch).toEqual({ value: 10, sample: 1 });
    expect(summary.matchesWithStatistics).toBe(3);
  });

  it("computes accuracy from summed counts, not a mean of per-match percentages", () => {
    // 1 of 1 in one match and 5 of 30 in another is 6 of 31 (19%), not the
    // mean of 100% and 17%.
    const summary = summarizeTeamStatistics([
      row({ shots_total: 1, shots_on_target: 1 }),
      row({ shots_total: 30, shots_on_target: 5 }),
    ]);
    expect(summary.shotAccuracy).toEqual({ made: 6, attempted: 31, pct: 19, sample: 2 });
  });

  it("ignores a match that reports only one half of a ratio", () => {
    const summary = summarizeTeamStatistics([
      row({ passes_total: 400, passes_accurate: 340 }),
      row({ passes_total: 500 }),
      row({ passes_accurate: 100 }),
    ]);
    expect(summary.passAccuracy).toEqual({ made: 340, attempted: 400, pct: 85, sample: 1 });
  });

  it("refuses a ratio whose denominator really is zero", () => {
    const summary = summarizeTeamStatistics([row({ shots_total: 0, shots_on_target: 0 })]);
    expect(summary.shotAccuracy).toBeNull();
  });

  it("keeps two decimals for expected goals and one elsewhere", () => {
    const summary = summarizeTeamStatistics([
      row({ expected_goals: 1.234, shots_total: 12 }),
      row({ expected_goals: 2.111, shots_total: 15 }),
    ]);
    expect(summary.expectedGoalsPerMatch).toEqual({ value: 1.67, sample: 2 });
    expect(summary.shotsPerMatch).toEqual({ value: 13.5, sample: 2 });
  });
});
