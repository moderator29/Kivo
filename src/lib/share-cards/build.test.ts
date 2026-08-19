import { describe, expect, it } from "vitest";
import {
  MAX_TABLE_ROWS,
  buildLeagueTableCard,
  buildLiveScoreCard,
  buildPlayerComparisonCard,
  buildPlayerPerformanceCard,
  buildPredictionCard,
  buildTransferCard,
  ordinal,
  stat,
  type LiveScoreFixtureRow,
  type PlayerRow,
  type PlayerTotals,
  type StandingRow,
} from "./build";

/**
 * These tests exist for one reason: a share card travels. Nobody who receives
 * one can check it against the app, so a fabricated or defaulted number on a
 * card is the worst version of that failure in the whole product. Every case
 * below is a way a zero could sneak onto a card, and the assertion is that it
 * doesn't.
 */

const team = (id: string, name: string) => ({ id, name, short_name: name.slice(0, 3).toUpperCase(), crest_url: null });

const baseFixture: LiveScoreFixtureRow = {
  status: "finished",
  kickoff_at: "2026-08-16T17:30:00.000Z",
  home_score: 2,
  away_score: 1,
  minute_elapsed: null,
  competition: { name: "Premier League" },
  venue: { name: "Emirates Stadium", city: "London" },
  home_team: team("home-id", "Arsenal"),
  away_team: team("away-id", "Manchester United"),
};

const emptyTotals: PlayerTotals = {
  appearances: null,
  starts: null,
  goals: null,
  assists: null,
  yellowCards: null,
  redCards: null,
};

const player = (name: string): PlayerRow => ({
  full_name: name,
  photo_url: null,
  position: "Attacker",
  team: { name: "Galatasaray", short_name: "GAL", crest_url: null },
});

describe("stat", () => {
  it("keeps a real zero, because a player who played and scored none really scored none", () => {
    expect(stat("Goals", 0)).toEqual({ label: "Goals", value: "0", emphasis: false });
  });

  it("drops an unknown value rather than printing it as zero", () => {
    expect(stat("Goals", null)).toBeNull();
    expect(stat("Goals", undefined)).toBeNull();
    expect(stat("Fee", "  ")).toBeNull();
  });
});

describe("buildLiveScoreCard", () => {
  it("shows no score at all before kickoff instead of 0-0", () => {
    const card = buildLiveScoreCard(
      { ...baseFixture, status: "scheduled", home_score: null, away_score: null },
      [],
    );
    expect(card?.homeScore).toBeNull();
    expect(card?.awayScore).toBeNull();
    expect(card?.statusLabel).toBe("KICK-OFF");
  });

  it("refuses to render a fixture missing one of its teams", () => {
    expect(buildLiveScoreCard({ ...baseFixture, away_team: null }, [])).toBeNull();
  });

  it("only shows a minute while the match is genuinely live and one is synced", () => {
    expect(buildLiveScoreCard({ ...baseFixture, status: "live", minute_elapsed: 67 }, [])?.minuteLabel).toBe("67'");
    expect(buildLiveScoreCard({ ...baseFixture, status: "live", minute_elapsed: null }, [])?.minuteLabel).toBeNull();
    expect(buildLiveScoreCard({ ...baseFixture, minute_elapsed: 90 }, [])?.minuteLabel).toBeNull();
  });

  it("credits an own goal to the team it actually helped", () => {
    const card = buildLiveScoreCard(baseFixture, [
      { event_type: "own_goal", minute: 30, added_time: null, team_id: "home-id", player_name: "Own Goaler" },
    ]);
    expect(card?.scorers[0]).toMatchObject({ side: "away", isOwnGoal: true });
  });

  it("drops goal events with no player name rather than inventing one", () => {
    const card = buildLiveScoreCard(baseFixture, [
      { event_type: "goal", minute: 30, added_time: null, team_id: "home-id", player_name: null },
    ]);
    expect(card?.scorers).toHaveLength(0);
  });
});

describe("buildPlayerPerformanceCard", () => {
  it("returns no card when nothing about the player is synced", () => {
    expect(buildPlayerPerformanceCard(player("Nobody"), emptyTotals, "window")).toBeNull();
  });

  it("keeps synced zeros and omits only the unsynced stats", () => {
    const card = buildPlayerPerformanceCard(
      player("Victor Osimhen"),
      { ...emptyTotals, appearances: 4, starts: 3, goals: 0 },
      "All matches synced to KIVO",
    );
    expect(card?.stats.map((s) => s.label)).toEqual(["Apps", "Starts", "Goals"]);
    expect(card?.stats.find((s) => s.label === "Goals")?.value).toBe("0");
  });

  it("never shows assists, because KIVO has no assist data to show", () => {
    const card = buildPlayerPerformanceCard(player("Anyone"), { ...emptyTotals, goals: 3 }, "window");
    expect(card?.stats.some((s) => s.label === "Assists")).toBe(false);
  });
});

describe("buildPlayerComparisonCard", () => {
  it("drops any row where only one side has a real number", () => {
    const card = buildPlayerComparisonCard(
      { player: player("A"), totals: { ...emptyTotals, goals: 12, appearances: 20 } },
      { player: player("B"), totals: { ...emptyTotals, goals: 9 } },
      "window",
    );
    expect(card?.rows.map((r) => r.label)).toEqual(["Goals"]);
  });

  it("returns nothing at all when the two players share no comparable stat", () => {
    expect(
      buildPlayerComparisonCard(
        { player: player("A"), totals: { ...emptyTotals, goals: 12 } },
        { player: player("B"), totals: { ...emptyTotals, appearances: 4 } },
        "window",
      ),
    ).toBeNull();
  });

  it("marks a leader only where more is unambiguously better", () => {
    const card = buildPlayerComparisonCard(
      { player: player("A"), totals: { ...emptyTotals, goals: 12, appearances: 30, redCards: 2 } },
      { player: player("B"), totals: { ...emptyTotals, goals: 9, appearances: 20, redCards: 0 } },
      "window",
    );
    expect(card?.rows.find((r) => r.label === "Goals")?.leader).toBe("left");
    // More appearances is not an achievement, and more red cards certainly is
    // not — neither gets a winner's highlight.
    expect(card?.rows.find((r) => r.label === "Appearances")?.leader).toBe("tie");
    expect(card?.rows.find((r) => r.label === "Red cards")?.leader).toBe("tie");
  });
});

describe("buildPredictionCard", () => {
  const profile = { display_name: "Tunde", username: "tundea", avatar_src: null };

  it("stays pending, with no points, until the fixture is actually settled", () => {
    const card = buildPredictionCard(
      { predicted_outcome: "home_win", points_awarded: null },
      { ...baseFixture, status: "scheduled", home_score: null, away_score: null },
      profile,
    );
    expect(card?.outcome).toBe("pending");
    expect(card?.pointsAwarded).toBeNull();
    expect(card?.actualLabel).toBeNull();
  });

  it("reads the real result rather than assuming the prediction was right", () => {
    const missed = buildPredictionCard({ predicted_outcome: "away_win", points_awarded: 0 }, baseFixture, profile);
    expect(missed?.outcome).toBe("missed");
    // A scored zero is a real awarded value and stays on the card.
    expect(missed?.pointsAwarded).toBe(0);

    const correct = buildPredictionCard({ predicted_outcome: "home_win", points_awarded: 30 }, baseFixture, profile);
    expect(correct?.outcome).toBe("correct");
  });
});

describe("buildLeagueTableCard", () => {
  const rows = (count: number): StandingRow[] =>
    Array.from({ length: count }, (_, index) => ({
      position: index + 1,
      played: 6,
      goals_for: 10,
      goals_against: index,
      points: 30 - index,
      team: { name: `Club ${index + 1}`, short_name: `C${index + 1}`, crest_url: null },
    }));

  it("drops rows the provider never placed rather than guessing an order", () => {
    const card = buildLeagueTableCard("Premier League", "2026/27", [
      ...rows(3),
      { position: null, played: 6, goals_for: 3, goals_against: 9, points: 2, team: { name: "Unplaced", short_name: null, crest_url: null } },
    ], null);
    expect(card?.rows).toHaveLength(3);
  });

  it("says so when it is only showing a window of a longer table", () => {
    const card = buildLeagueTableCard("Premier League", "2026/27", rows(20), null);
    expect(card?.rows).toHaveLength(MAX_TABLE_ROWS);
    expect(card?.truncatedNote).toBe("Positions 1–10 of 20");
  });

  it("slides the window so the highlighted club is actually on the card", () => {
    const card = buildLeagueTableCard("Premier League", "2026/27", rows(20), "Club 17");
    expect(card?.rows.some((row) => row.team.name === "Club 17")).toBe(true);
  });

  it("returns nothing when the table has no placed rows at all", () => {
    expect(buildLeagueTableCard("Premier League", "2026/27", [], null)).toBeNull();
  });
});

describe("buildTransferCard", () => {
  const base = {
    transfer_date: "2026-08-12",
    fee_text: null,
    transfer_type: "transfer",
    player: { full_name: "Ademola Lookman", photo_url: null },
    from_team: { name: "Atalanta", short_name: "ATA", crest_url: null },
    to_team: { name: "Internazionale", short_name: "INT", crest_url: null },
  };

  it("labels every synced move as confirmed, because that is the only tier the data supports", () => {
    expect(buildTransferCard(base, "Transfer", "API-Football")?.statusLabel).toBe("Confirmed");
  });

  it("omits the fee rather than printing an undisclosed one as zero", () => {
    expect(buildTransferCard(base, "Transfer", "API-Football")?.feeText).toBeNull();
    expect(buildTransferCard({ ...base, fee_text: "€ 45M" }, "Transfer", "API-Football")?.feeText).toBe("€ 45M");
  });

  it("refuses a move with neither club resolved", () => {
    expect(buildTransferCard({ ...base, from_team: null, to_team: null }, "Transfer", "API-Football")).toBeNull();
  });
});

describe("ordinal", () => {
  it("handles the teens, which is where naive ordinal code goes wrong", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 111].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "111th",
    ]);
  });
});
