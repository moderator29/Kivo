import { describe, expect, it } from "vitest";
import { NORMALIZED_PITCH, isOnPitch, toRenderSpace } from "./pitch-coordinates";
import { EventNormalizer, classifyMatchEvent, periodForMinute } from "./event-normalizer";
import { PlayerPositionMapper, normalizePositionLine } from "./player-position-mapper";
import { HeatmapAggregator } from "./heatmap-aggregator";
import { buildFixtureHeatmaps, buildPlayerHeatmap, hasFixtureHeatmapContent } from "./fixture-heatmap";
import { PITCH_DIMENSIONS } from "../heatmap-engine";
import type { PositionalObservation } from "../positional-types";

const lineup = (
  playerId: string,
  teamId: string,
  position: string | null,
  grid: string | null,
  isStarting = true,
) => ({
  teamId,
  playerId,
  playerName: `Player ${playerId}`,
  isStarting,
  position,
  formation: "4-3-3",
  shirtNumber: null,
  grid,
});

/** A full, grid-carrying 4-3-3 for one side — the shape the mapper calibrates
 * itself against, so the row/column normalization is exercised against real
 * counts rather than a single row. */
const FULL_XI = [
  lineup("gk", "home", "G", "1:1"),
  lineup("rb", "home", "D", "2:1"),
  lineup("rcb", "home", "D", "2:2"),
  lineup("lcb", "home", "D", "2:3"),
  lineup("lb", "home", "D", "2:4"),
  lineup("dm", "home", "M", "3:1"),
  lineup("cm", "home", "M", "3:2"),
  lineup("am", "home", "M", "3:3"),
  lineup("rw", "home", "F", "4:1"),
  lineup("st", "home", "F", "4:2"),
  lineup("lw", "home", "F", "4:3"),
];

describe("pitch-coordinates", () => {
  it("puts the goal being attacked at the TOP of the render space, matching every other KIVO pitch", () => {
    // Canonical y = 100 is the goal being attacked; LineupPitch draws attack at
    // the top, so it must land at render y = 0, not y = 140.
    expect(toRenderSpace({ x: 50, y: 100 }).y).toBeCloseTo(0);
    expect(toRenderSpace({ x: 50, y: 0 }).y).toBeCloseTo(PITCH_DIMENSIONS.height);
  });

  it("flips only the depth axis in defensive orientation, and never mutates the input", () => {
    const point = { x: 20, y: 80 };
    const attacking = toRenderSpace(point, "attacking");
    const defensive = toRenderSpace(point, "defensive");
    expect(defensive.x).toBeCloseTo(attacking.x);
    expect(defensive.y).toBeCloseTo(PITCH_DIMENSIONS.height - attacking.y);
    expect(point).toEqual({ x: 20, y: 80 });
  });

  it("rejects out-of-pitch points rather than clamping them", () => {
    expect(isOnPitch({ x: 0, y: 0 })).toBe(true);
    expect(isOnPitch({ x: NORMALIZED_PITCH.width, y: NORMALIZED_PITCH.height })).toBe(true);
    expect(isOnPitch({ x: -1, y: 50 })).toBe(false);
    expect(isOnPitch({ x: 50, y: 101 })).toBe(false);
    expect(isOnPitch({ x: Number.NaN, y: 50 })).toBe(false);
  });
});

describe("EventNormalizer", () => {
  const normalizer = new EventNormalizer();

  it("never attaches a coordinate to a match event, because the provider publishes none", () => {
    const actions = normalizer.fromMatchEvents([
      { teamId: "home", playerId: "st", eventType: "goal", minute: 63 },
      { teamId: "home", playerId: "rb", eventType: "yellow_card", minute: 22 },
    ]);
    expect(actions).toHaveLength(2);
    expect(actions.every((a) => a.coordinate === null)).toBe(true);
    expect(actions.every((a) => a.sourceKind === "match-event")).toBe(true);
  });

  it("drops an event with no player, since a heatmap has nobody to attribute it to", () => {
    expect(normalizer.fromMatchEvents([{ teamId: "home", playerId: null, eventType: "var_review", minute: 10 }])).toEqual([]);
  });

  it("splits periods on the laws of the game, and never folds added time into the next half", () => {
    expect(periodForMinute(1)).toBe("first-half");
    expect(periodForMinute(45)).toBe("first-half");
    expect(periodForMinute(46)).toBe("second-half");
    expect(periodForMinute(90)).toBe("second-half");
    expect(periodForMinute(97)).toBe("extra-time");
    expect(periodForMinute(-1)).toBeNull();
  });

  it("classifies a substitution as unclassified — it says nothing about where a player played", () => {
    expect(classifyMatchEvent("substitution")).toBe("unclassified");
    expect(classifyMatchEvent("goal")).toBe("attacking");
    expect(classifyMatchEvent("own_goal")).toBe("defensive");
    expect(classifyMatchEvent("red_card")).toBe("discipline");
    expect(classifyMatchEvent("something-the-provider-invented")).toBe("unclassified");
  });

  it("leaves statistic-derived actions with no period, because a match total belongs to no half", () => {
    const actions = normalizer.fromPlayerMatchStatistics([
      { playerId: "cm", teamId: "home", passesTotal: 41, tacklesTotal: 3 },
    ]);
    expect(actions).toHaveLength(2);
    expect(actions.every((a) => a.period === null)).toBe(true);
    expect(actions.find((a) => a.actionClass === "buildUp")?.weight).toBe(41);
  });

  it("treats a null statistic and a zero statistic alike as contributing nothing, without inventing either", () => {
    const actions = normalizer.fromPlayerMatchStatistics([
      { playerId: "gk", teamId: "home", tacklesTotal: null, shotsTotal: 0, saves: 4 },
    ]);
    expect(actions).toHaveLength(1);
    expect(actions[0].actionClass).toBe("goalkeeping");
    expect(actions[0].weight).toBe(4);
  });

  it("carries a coordinate through only for a real tracked observation, and drops off-pitch ones", () => {
    const observation = (x: number, y: number): PositionalObservation => ({
      playerId: "st",
      matchId: "m1",
      timestamp: "2026-01-01T00:00:00Z",
      x,
      y,
      eventType: "touch",
      confidence: null,
      source: "some-tracking-vendor",
    });
    const actions = normalizer.fromObservations([observation(30, 70), observation(30, 140)], "home");
    expect(actions).toHaveLength(1);
    expect(actions[0].coordinate).toEqual({ x: 30, y: 70 });
    expect(actions[0].sourceKind).toBe("tracked-observation");
    expect(actions[0].source).toBe("some-tracking-vendor");
  });
});

describe("PlayerPositionMapper", () => {
  const mapper = new PlayerPositionMapper();

  it("anchors a goalkeeper deep and a forward high, from the formation grid alone", () => {
    const anchors = mapper.anchorTeam(FULL_XI);
    const gk = anchors.get("gk")!;
    const st = anchors.get("st")!;
    expect(gk.depthConfidence).toBe("formation-slot");
    expect(gk.coordinate.y).toBeLessThan(st.coordinate.y);
    // A keeper is in front of their goal line, never on it.
    expect(gk.coordinate.y).toBeGreaterThan(0);
    expect(st.coordinate.y).toBeLessThan(NORMALIZED_PITCH.height);
  });

  it("spreads a back four across the width and centres a lone goalkeeper", () => {
    const anchors = mapper.anchorTeam(FULL_XI);
    const xs = ["rb", "rcb", "lcb", "lb"].map((id) => anchors.get(id)!.coordinate.x);
    expect(new Set(xs).size).toBe(4);
    expect(Math.min(...xs)).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThan(NORMALIZED_PITCH.width);
    // The keeper is the only player in row 1, so central is known by elimination
    // rather than assumed — and the mapper says so.
    expect(anchors.get("gk")!.coordinate.x).toBeCloseTo(50);
    expect(anchors.get("gk")!.lateralConfidence).toBe("none");
    expect(anchors.get("rb")!.lateralConfidence).toBe("provider-order");
  });

  it("falls back to the listed position with no lateral claim when there is no grid", () => {
    const anchor = mapper.anchorFor(lineup("x", "home", "Midfielder", null));
    expect(anchor).not.toBeNull();
    expect(anchor!.depthConfidence).toBe("position-line");
    expect(anchor!.lateralConfidence).toBe("none");
    expect(anchor!.coordinate.x).toBeCloseTo(50);
  });

  it("returns null rather than dropping an unrecognised player into midfield", () => {
    expect(mapper.anchorFor(lineup("x", "home", "Sweeper-keeper-libero", null))).toBeNull();
    expect(mapper.anchorFor(lineup("x", "home", null, null))).toBeNull();
    expect(normalizePositionLine("wing back")).toBeNull();
  });

  it("never anchors a substitute, whose match position nobody recorded", () => {
    const anchors = mapper.anchorTeam([...FULL_XI, lineup("sub", "home", "F", null, false)]);
    expect(anchors.has("sub")).toBe(false);
  });
});

describe("HeatmapAggregator", () => {
  const aggregator = new HeatmapAggregator();
  const mapper = new PlayerPositionMapper();
  const normalizer = new EventNormalizer();

  it("tags a coordinate-free grid as derived, and reports a real action count", () => {
    const anchor = mapper.anchorTeam(FULL_XI).get("st")!;
    const actions = normalizer.fromPlayerMatchStatistics([
      { playerId: "st", teamId: "home", shotsTotal: 5, passesTotal: 20 },
    ]);
    const result = aggregator.aggregate(actions, anchor);
    expect(result.derivation).toBe("derived");
    expect(result.hasData).toBe(true);
    expect(result.totalActions).toBe(25);
  });

  it("uses the tracked path, and ignores the anchor entirely, the moment a real coordinate exists", () => {
    const anchor = mapper.anchorTeam(FULL_XI).get("gk")!;
    const tracked = normalizer.fromObservations(
      [
        {
          playerId: "gk",
          matchId: "m1",
          timestamp: "2026-01-01T00:00:00Z",
          x: 90,
          y: 95,
          eventType: "touch",
          confidence: null,
          source: "vendor",
        },
      ],
      "home",
    );
    const result = aggregator.aggregate(tracked, anchor);
    expect(result.derivation).toBe("tracked");
    // The single observation is in the far attacking corner even though the
    // anchor is a goalkeeper's — proof the anchor did not contribute.
    const hottest = result.grid.zones.reduce((a, b) => (b.weight > a.weight ? b : a));
    expect(hottest.y0).toBeGreaterThanOrEqual(80);
    expect(hottest.x0).toBeGreaterThanOrEqual(80);
  });

  it("leans a derived shape deeper for defensive work than for attacking work", () => {
    const anchor = mapper.anchorTeam(FULL_XI).get("cm")!;
    const centreOfMass = (weights: { defensive?: number; attacking?: number }) => {
      const actions = normalizer.fromPlayerMatchStatistics([
        { playerId: "cm", teamId: "home", tacklesTotal: weights.defensive ?? null, shotsTotal: weights.attacking ?? null },
      ]);
      const grid = aggregator.aggregate(actions, anchor).grid;
      const total = grid.zones.reduce((sum, z) => sum + z.weight, 0);
      return grid.zones.reduce((sum, z) => sum + ((z.y0 + z.y1) / 2) * z.weight, 0) / total;
    };
    expect(centreOfMass({ defensive: 40 })).toBeLessThan(centreOfMass({ attacking: 40 }));
  });

  it("spreads wider laterally when the mapper had no formation column than when it had one", () => {
    const withColumn = mapper.anchorTeam(FULL_XI).get("rw")!;
    const withoutColumn = mapper.anchorFor(lineup("x", "home", "Forward", null))!;
    const spread = (anchor: typeof withColumn) => {
      const grid = aggregator.aggregate([], anchor).grid;
      const total = grid.zones.reduce((sum, z) => sum + z.weight, 0);
      const meanX = grid.zones.reduce((sum, z) => sum + ((z.x0 + z.x1) / 2) * z.weight, 0) / total;
      return Math.sqrt(
        grid.zones.reduce((sum, z) => sum + z.weight * ((z.x0 + z.x1) / 2 - meanX) ** 2, 0) / total,
      );
    };
    expect(spread(withoutColumn)).toBeGreaterThan(spread(withColumn));
  });

  it("returns an empty, hasData:false grid when there is no anchor — never a centre-of-pitch blob", () => {
    const actions = normalizer.fromMatchEvents([{ teamId: "home", playerId: "x", eventType: "goal", minute: 10 }]);
    const result = aggregator.aggregate(actions, null);
    expect(result.hasData).toBe(false);
    expect(result.grid.zones.every((z) => z.weight === 0)).toBe(true);
    // The action is still counted, so a caller can say "we know they scored,
    // we just cannot place them".
    expect(result.totalActions).toBe(1);
  });

  it("excludes period-less statistics from a half view, and reports exactly how many it dropped", () => {
    const anchor = mapper.anchorTeam(FULL_XI).get("cm")!;
    const actions = [
      ...normalizer.fromMatchEvents([{ teamId: "home", playerId: "cm", eventType: "goal", minute: 20 }]),
      ...normalizer.fromPlayerMatchStatistics([{ playerId: "cm", teamId: "home", passesTotal: 30, tacklesTotal: 2 }]),
    ];
    const firstHalf = aggregator.aggregate(actions, anchor, { period: "first-half" });
    expect(firstHalf.totalActions).toBe(1);
    expect(firstHalf.actionsWithoutPeriod).toBe(2);

    const secondHalf = aggregator.aggregate(actions, anchor, { period: "second-half" });
    expect(secondHalf.totalActions).toBe(0);

    const full = aggregator.aggregate(actions, anchor, { period: "full-match" });
    expect(full.totalActions).toBe(33);
    expect(full.actionsWithoutPeriod).toBe(0);
  });
});

describe("buildFixtureHeatmaps", () => {
  const events = [
    { teamId: "home", playerId: "st", eventType: "goal", minute: 63 },
    { teamId: "away", playerId: "away-gk", eventType: "yellow_card", minute: 30 },
  ];

  it("reports no content for a fixture with no lineup — so the tab is never offered empty", () => {
    const set = buildFixtureHeatmaps({
      fixtureId: "f1",
      homeTeamId: "home",
      awayTeamId: "away",
      lineups: [],
      events,
    });
    expect(hasFixtureHeatmapContent(set)).toBe(false);
    expect(set.home.players).toEqual([]);
  });

  it("reports content as soon as one starter can be anchored, and that player has a drawable grid", () => {
    const set = buildFixtureHeatmaps({
      fixtureId: "f1",
      homeTeamId: "home",
      awayTeamId: "away",
      lineups: FULL_XI,
      events,
    });
    expect(hasFixtureHeatmapContent(set)).toBe(true);
    const striker = set.home.players.find((p) => p.playerId === "st")!;
    expect(striker.anchor).not.toBeNull();
    expect(buildPlayerHeatmap(striker).hasData).toBe(true);
  });

  it("offers only the periods the fixture actually has, so no filter can render empty", () => {
    const set = buildFixtureHeatmaps({
      fixtureId: "f1",
      homeTeamId: "home",
      awayTeamId: "away",
      lineups: FULL_XI,
      events,
    });
    // A first-half card and a second-half goal; no extra time was played, so
    // no extra-time chip is offered.
    expect(set.periodsPresent).toEqual(["first-half", "second-half"]);
    expect(set.hasTrackedData).toBe(false);
  });

  it("lists a substitute with no anchor rather than drawing them somewhere invented", () => {
    const set = buildFixtureHeatmaps({
      fixtureId: "f1",
      homeTeamId: "home",
      awayTeamId: "away",
      lineups: [...FULL_XI, lineup("sub", "home", "F", null, false)],
      events: [],
    });
    const sub = set.home.players.find((p) => p.playerId === "sub")!;
    expect(sub.anchor).toBeNull();
    expect(buildPlayerHeatmap(sub).hasData).toBe(false);
    // Starters are listed before substitutes — team-sheet order, not a ranking.
    expect(set.home.players.at(-1)!.playerId).toBe("sub");
  });

  it("keeps the two sides separate, so one team's events never shape the other's players", () => {
    const set = buildFixtureHeatmaps({
      fixtureId: "f1",
      homeTeamId: "home",
      awayTeamId: "away",
      lineups: [...FULL_XI, lineup("away-gk", "away", "G", "1:1")],
      events,
    });
    expect(set.home.players.map((p) => p.teamId).every((id) => id === "home")).toBe(true);
    expect(set.away.players).toHaveLength(1);
    expect(set.away.players[0].actions).toHaveLength(1);
  });
});
