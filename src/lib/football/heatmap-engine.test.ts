import { describe, expect, it } from "vitest";
import { HeatmapEngine, PITCH_DIMENSIONS } from "./heatmap-engine";
import type { PositionalObservation } from "./positional-types";

const obs = (x: number, y: number, overrides: Partial<PositionalObservation> = {}): PositionalObservation => ({
  playerId: "p1",
  matchId: "m1",
  timestamp: "2026-01-01T00:00:00Z",
  x,
  y,
  eventType: "touch",
  confidence: null,
  source: "test-provider",
  ...overrides,
});

describe("HeatmapEngine", () => {
  it("reports hasData: false for an empty observation set — the correct state today with no connected provider", () => {
    const engine = new HeatmapEngine();
    const result = engine.build([]);
    expect(result.hasData).toBe(false);
    expect(result.grid.totalObservations).toBe(0);
    expect(result.grid.maxZoneCount).toBe(0);
    expect(result.sourcesUsed).toEqual([]);
    // Every zone still exists (a full grid of zeros), just with zero density everywhere.
    expect(result.grid.zones.length).toBe(result.grid.cols * result.grid.rows);
    expect(result.grid.zones.every((z) => z.count === 0 && z.density === 0)).toBe(true);
  });

  it("buckets observations into the correct zone and normalizes density against the busiest zone", () => {
    const engine = new HeatmapEngine(2, 2); // 4 zones, each 50 wide x 70 tall
    const result = engine.build([
      obs(10, 10), // zone (0,0)
      obs(10, 10), // zone (0,0) again
      obs(90, 10), // zone (1,0)
    ]);

    expect(result.hasData).toBe(true);
    expect(result.grid.totalObservations).toBe(3);
    expect(result.grid.maxZoneCount).toBe(2);

    const topLeft = result.grid.zones.find((z) => z.col === 0 && z.row === 0)!;
    const topRight = result.grid.zones.find((z) => z.col === 1 && z.row === 0)!;
    const bottomLeft = result.grid.zones.find((z) => z.col === 0 && z.row === 1)!;

    expect(topLeft.count).toBe(2);
    expect(topLeft.density).toBe(1);
    expect(topRight.count).toBe(1);
    expect(topRight.density).toBe(0.5);
    expect(bottomLeft.count).toBe(0);
    expect(bottomLeft.density).toBe(0);
  });

  it("skips out-of-bounds observations rather than clamping them into an edge zone", () => {
    const engine = new HeatmapEngine();
    const result = engine.build([obs(-5, 10), obs(10, 1000), obs(PITCH_DIMENSIONS.width + 1, 10)]);
    expect(result.hasData).toBe(false);
    expect(result.grid.totalObservations).toBe(0);
  });

  it("includes a boundary-edge coordinate in the last zone instead of dropping it", () => {
    const engine = new HeatmapEngine(2, 2);
    const result = engine.build([obs(PITCH_DIMENSIONS.width, PITCH_DIMENSIONS.height)]);
    expect(result.hasData).toBe(true);
    const bottomRight = result.grid.zones.find((z) => z.col === 1 && z.row === 1)!;
    expect(bottomRight.count).toBe(1);
  });

  it("echoes scope and collects distinct sources", () => {
    const engine = new HeatmapEngine();
    const result = engine.build(
      [obs(10, 10, { source: "vendor-a" }), obs(20, 20, { source: "vendor-b" }), obs(30, 30, { source: "vendor-a" })],
      { playerId: "p1", matchId: "m1" },
    );
    expect(result.playerId).toBe("p1");
    expect(result.matchId).toBe("m1");
    expect(result.sourcesUsed.sort()).toEqual(["vendor-a", "vendor-b"]);
  });

  it("echoes null scope when none is given", () => {
    const engine = new HeatmapEngine();
    const result = engine.build([]);
    expect(result.playerId).toBeNull();
    expect(result.matchId).toBeNull();
  });
});
