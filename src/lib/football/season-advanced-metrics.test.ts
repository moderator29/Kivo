import { describe, expect, it } from "vitest";
import {
  buildAdvancedMetricGroups,
  hasAdvancedMetrics,
  type SeasonStatisticsRow,
} from "./season-advanced-metrics";

/** Every column unreported. Each test turns on only what it is about, so a
 * passing assertion is never propped up by a value the test didn't set. */
const EMPTY: SeasonStatisticsRow = {
  lineups: null,
  position: null,
  provider_rating: null,
  shots_total: null,
  shots_on_target: null,
  penalties_scored: null,
  penalties_missed: null,
  passes_total: null,
  passes_key: null,
  pass_accuracy: null,
  dribbles_attempted: null,
  dribbles_succeeded: null,
  duels_total: null,
  duels_won: null,
  tackles_total: null,
  interceptions: null,
  blocks: null,
  fouls_committed: null,
  fouls_drawn: null,
  yellow_cards: null,
  red_cards: null,
  saves: null,
  goals_conceded: null,
};

function find(row: SeasonStatisticsRow, label: string) {
  return buildAdvancedMetricGroups(row)
    .flatMap((group) => group.metrics)
    .find((metric) => metric.label === label);
}

describe("buildAdvancedMetricGroups", () => {
  it("returns nothing at all when the provider reported nothing", () => {
    expect(buildAdvancedMetricGroups(EMPTY)).toEqual([]);
    expect(hasAdvancedMetrics(EMPTY)).toBe(false);
  });

  it("keeps a reported zero, because zero fouls is a fact about the player", () => {
    expect(find({ ...EMPTY, fouls_committed: 0 }, "Fouls committed")?.value).toBe("0");
  });

  it("omits an unreported metric rather than rendering it as zero", () => {
    expect(find({ ...EMPTY, tackles_total: 4 }, "Interceptions")).toBeUndefined();
  });

  it("drops a group entirely when nothing in it was reported", () => {
    const groups = buildAdvancedMetricGroups({ ...EMPTY, saves: 30, goals_conceded: 18 });
    expect(groups.map((group) => group.title)).toEqual(["Goalkeeping"]);
  });

  describe("ratios", () => {
    it("pairs two halves that came from the same row", () => {
      expect(find({ ...EMPTY, dribbles_succeeded: 12, dribbles_attempted: 20 }, "Dribbles completed")?.value).toBe(
        "12 of 20",
      );
    });

    it("never invents the missing half of a ratio", () => {
      // Numerator only: the surviving number is shown on its own terms, not as
      // a fraction with a fabricated denominator.
      expect(find({ ...EMPTY, duels_won: 40 }, "Duels won")?.value).toBe("40");
      // Denominator only: relabelled to say what it actually counts.
      expect(find({ ...EMPTY, duels_total: 90 }, "Duels contested")?.value).toBe("90");
    });

    it("names a lone denominator for what it is, not for the ratio it isn't", () => {
      // Caught in a real render: shot volume with no accuracy reported came
      // out as "Shots on target attempted", a true number under a label
      // describing a different measurement.
      const groups = buildAdvancedMetricGroups({ ...EMPTY, shots_total: 9 });
      const labels = groups.flatMap((group) => group.metrics).map((metric) => metric.label);
      expect(labels).toContain("Shots");
      expect(labels).not.toContain("Shots on target");
      expect(find({ ...EMPTY, shots_total: 9 }, "Shots")?.value).toBe("9");
    });

    it("treats a reported zero as a real half of a ratio", () => {
      expect(find({ ...EMPTY, shots_on_target: 0, shots_total: 7 }, "Shots on target")?.value).toBe("0 of 7");
    });
  });

  it("carries the unit on a percentage, so it cannot be read as a count", () => {
    expect(find({ ...EMPTY, pass_accuracy: 84 }, "Pass accuracy")?.value).toBe("84%");
  });

  it("renders the provider's rating at the precision it publishes, labelled as theirs", () => {
    expect(find({ ...EMPTY, provider_rating: 7.3 }, "Provider rating")?.value).toBe("7.30");
  });

  it("never emits a total, because nothing here may span competitions", () => {
    const groups = buildAdvancedMetricGroups({ ...EMPTY, shots_total: 10, tackles_total: 5 });
    const labels = groups.flatMap((group) => group.metrics).map((metric) => metric.label.toLowerCase());
    expect(labels.some((label) => label.includes("total") || label.includes("all competitions"))).toBe(false);
  });
});
