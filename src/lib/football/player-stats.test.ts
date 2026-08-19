import { describe, expect, it } from "vitest";
import { computePlayerMatchStats } from "./player-stats";

const played = (isStarting: boolean) => ({ is_starting: isStarting, fixture: { status: "finished" as const } });

describe("computePlayerMatchStats", () => {
  it("counts appearances only for matches that were actually played", () => {
    const stats = computePlayerMatchStats(
      [played(true), played(false), { is_starting: true, fixture: { status: "scheduled" } }],
      [],
    );
    expect(stats.appearances).toBe(2);
    expect(stats.starts).toBe(1);
  });

  it("reports assists as unknown when the caller did not query them", () => {
    // The load-bearing case: every call site that predates assists must keep
    // saying "we don't know", never "zero".
    expect(computePlayerMatchStats([played(true)], []).assists).toBeNull();
  });

  it("counts a real zero once assist rows are actually queried", () => {
    expect(computePlayerMatchStats([played(true)], [], []).assists).toBe(0);
  });

  it("counts assists on goals and penalties, and nothing else", () => {
    const stats = computePlayerMatchStats([played(true)], [], [
      { event_type: "goal" },
      { event_type: "penalty_goal" },
      // A substitution also carries related_player_id — the player coming on.
      // Counting it would turn every bench appearance into an assist.
      { event_type: "substitution" },
      // An own goal has no assister.
      { event_type: "own_goal" },
    ]);
    expect(stats.assists).toBe(2);
  });

  it("keeps goals and cards counted off the player's own events", () => {
    const stats = computePlayerMatchStats(
      [played(true)],
      [
        { event_type: "goal" },
        { event_type: "penalty_goal" },
        { event_type: "own_goal" },
        { event_type: "yellow_card" },
        { event_type: "red_card" },
        { event_type: "second_yellow_card" },
      ],
      [],
    );
    expect(stats.goals).toBe(2);
    expect(stats.yellowCards).toBe(1);
    expect(stats.redCards).toBe(2);
  });
});
