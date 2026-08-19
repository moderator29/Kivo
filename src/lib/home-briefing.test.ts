import { describe, expect, it } from "vitest";
import { buildHomeBriefing, type HomeBriefingFacts } from "./home-briefing";

const NOW = Date.parse("2026-08-19T12:00:00.000Z");
const inHours = (hours: number) => new Date(NOW + hours * 60 * 60 * 1000).toISOString();

const empty: HomeBriefingFacts = {
  now: NOW,
  clubsToday: { count: 0, liveCount: 0, nextKickoffAt: null, firstFixtureId: null },
  fantasy: null,
  predictions: null,
  latestTransfer: null,
  trendingRoom: null,
  unreadNotificationCount: 0,
};

const texts = (facts: HomeBriefingFacts) => buildHomeBriefing(facts).map((line) => line.text);

describe("buildHomeBriefing", () => {
  it("produces no briefing at all when there is nothing real to say", () => {
    // Not "a quiet day" — no card. A briefing whose only content is the
    // absence of content is filler.
    expect(buildHomeBriefing(empty)).toEqual([]);
  });

  it("says a club is playing now rather than counting down to it", () => {
    expect(
      texts({
        ...empty,
        clubsToday: { count: 2, liveCount: 1, nextKickoffAt: inHours(3), firstFixtureId: "f1" },
      }),
    ).toEqual(["One of your clubs is playing right now."]);
  });

  it("drops the countdown clause when the kickoff has already passed", () => {
    const [line] = texts({
      ...empty,
      clubsToday: { count: 1, liveCount: 0, nextKickoffAt: inHours(-2), firstFixtureId: "f1" },
    });
    expect(line).toBe("One of your clubs plays today.");
  });

  it("never reports fantasy points for a gameweek that has not been scored", () => {
    expect(
      texts({
        ...empty,
        fantasy: { gameweekNumber: 4, deadlineAt: null, rosterConfirmed: true, latestPoints: null },
      }),
    ).toEqual([]);

    expect(
      texts({
        ...empty,
        fantasy: { gameweekNumber: 4, deadlineAt: null, rosterConfirmed: true, latestPoints: 68 },
      }),
    ).toEqual(["You scored 68 in your last fantasy gameweek."]);
  });

  it("warns about an unconfirmed squad and congratulates a confirmed one", () => {
    expect(
      texts({
        ...empty,
        fantasy: { gameweekNumber: 4, deadlineAt: inHours(5), rosterConfirmed: false, latestPoints: null },
      })[0],
    ).toContain("isn't confirmed");

    expect(
      texts({
        ...empty,
        fantasy: { gameweekNumber: 4, deadlineAt: inHours(5), rosterConfirmed: true, latestPoints: null },
      })[0],
    ).toContain("squad is in");
  });

  it("treats one correct call as a result, not as a run", () => {
    expect(texts({ ...empty, predictions: { openCount: 0, currentStreak: 1 } })).toEqual([]);
    expect(texts({ ...empty, predictions: { openCount: 0, currentStreak: 2 } })).toEqual([
      "You're on a run of 2 correct calls.",
    ]);
  });

  it("prefers open calls over a streak, because one is actionable", () => {
    expect(texts({ ...empty, predictions: { openCount: 3, currentStreak: 5 } })).toEqual([
      "You have 3 calls that haven't locked yet.",
    ]);
  });

  it("links every line back to the surface the fact came from", () => {
    const lines = buildHomeBriefing({
      ...empty,
      clubsToday: { count: 1, liveCount: 0, nextKickoffAt: inHours(3), firstFixtureId: "fixture-1" },
      predictions: { openCount: 1, currentStreak: 0 },
      unreadNotificationCount: 2,
    });
    expect(lines.map((line) => line.href)).toEqual(["/matches/fixture-1", "/predictions/mine", "/notifications"]);
  });
});
