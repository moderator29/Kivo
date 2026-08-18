import { describe, expect, it } from "vitest";
import { selectHomeLead, type HomeLeadFacts, type LeadFixture } from "./home-lead";

const NOW = Date.parse("2026-08-18T12:00:00.000Z");

function fixture(overrides: Partial<LeadFixture> = {}): LeadFixture {
  return {
    id: "fixture-1",
    kickoffAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
    status: "scheduled",
    homeName: "Arsenal",
    homeCrestUrl: null,
    awayName: "Chelsea",
    awayCrestUrl: null,
    homeScore: null,
    awayScore: null,
    followedTeamName: "Arsenal",
    ...overrides,
  };
}

function facts(overrides: Partial<HomeLeadFacts> = {}): HomeLeadFacts {
  return {
    now: NOW,
    followedTeamCount: 1,
    liveFixture: null,
    nextFixture: null,
    nextFixturePrediction: null,
    openPredictionCount: 0,
    fantasy: null,
    ...overrides,
  };
}

describe("selectHomeLead", () => {
  it("leads with a followed club that is playing right now, over everything else", () => {
    const lead = selectHomeLead(
      facts({
        liveFixture: fixture({ status: "live", homeScore: 1, awayScore: 0 }),
        nextFixture: fixture({ id: "fixture-2" }),
        openPredictionCount: 4,
        fantasy: { gameweekNumber: 3, deadlineAt: new Date(NOW + 60_000).toISOString(), rosterConfirmed: false },
      }),
    );
    expect(lead.kind).toBe("live");
    expect(lead.reason).toBe("Because you follow Arsenal");
  });

  it("leads with a kickoff inside the next day, ahead of a fantasy deadline", () => {
    const lead = selectHomeLead(
      facts({
        nextFixture: fixture({ kickoffAt: new Date(NOW + 3 * 60 * 60 * 1000).toISOString() }),
        fantasy: { gameweekNumber: 3, deadlineAt: new Date(NOW + 60_000).toISOString(), rosterConfirmed: false },
      }),
    );
    expect(lead.kind).toBe("kickoff");
  });

  it("carries the viewer's own call on the leading fixture through, when they have made one", () => {
    const lead = selectHomeLead(
      facts({ nextFixture: fixture(), nextFixturePrediction: "Home win" }),
    );
    expect(lead).toMatchObject({ kind: "kickoff", prediction: "Home win" });
  });

  it("drops a kickoff more than a day out below a fantasy deadline inside the week", () => {
    const lead = selectHomeLead(
      facts({
        nextFixture: fixture({ kickoffAt: new Date(NOW + 3 * 24 * 60 * 60 * 1000).toISOString() }),
        fantasy: { gameweekNumber: 3, deadlineAt: new Date(NOW + 2 * 24 * 60 * 60 * 1000).toISOString(), rosterConfirmed: false },
      }),
    );
    expect(lead).toMatchObject({ kind: "fantasy_deadline", gameweekNumber: 3 });
  });

  it("ignores a fantasy deadline that has already passed, and one further out than a week", () => {
    const passed = selectHomeLead(
      facts({
        openPredictionCount: 2,
        fantasy: { gameweekNumber: 3, deadlineAt: new Date(NOW - 60_000).toISOString(), rosterConfirmed: true },
      }),
    );
    expect(passed.kind).toBe("open_predictions");

    const distant = selectHomeLead(
      facts({
        openPredictionCount: 2,
        fantasy: { gameweekNumber: 9, deadlineAt: new Date(NOW + 11 * 24 * 60 * 60 * 1000).toISOString(), rosterConfirmed: true },
      }),
    );
    expect(distant.kind).toBe("open_predictions");
  });

  it("falls back to a distant fixture once there is nothing more urgent", () => {
    const lead = selectHomeLead(
      facts({ nextFixture: fixture({ kickoffAt: new Date(NOW + 5 * 24 * 60 * 60 * 1000).toISOString() }) }),
    );
    expect(lead.kind).toBe("upcoming");
  });

  it("asks a user following nobody to follow a club, and never invents a reason for it", () => {
    const lead = selectHomeLead(facts({ followedTeamCount: 0 }));
    expect(lead.kind).toBe("follow_a_club");
  });

  it("admits there is nothing scheduled rather than filling the slot", () => {
    const lead = selectHomeLead(facts({ followedTeamCount: 2 }));
    expect(lead.kind).toBe("quiet");
  });

  it("omits the club half of the reason when the followed team name could not be resolved", () => {
    const lead = selectHomeLead(facts({ liveFixture: fixture({ status: "live", followedTeamName: null }) }));
    expect(lead.reason).toBe("Live right now");
  });
});
