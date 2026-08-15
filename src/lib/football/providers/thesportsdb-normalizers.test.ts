import { describe, expect, it } from "vitest";
import {
  buildEventKickoffIso,
  mapEvent,
  mapTheSportsDbStatus,
  parseSeasonYear,
  toIntOrZero,
  toNumberOrNull,
  toTheSportsDbSeasonString,
  type TheSportsDbEvent,
} from "./thesportsdb-normalizers";

describe("toNumberOrNull", () => {
  it("parses a numeric string", () => {
    expect(toNumberOrNull("3")).toBe(3);
  });

  it("passes a real number through", () => {
    expect(toNumberOrNull(7)).toBe(7);
  });

  it("returns null for null/undefined", () => {
    expect(toNumberOrNull(null)).toBeNull();
    expect(toNumberOrNull(undefined)).toBeNull();
  });

  it("returns null for a non-numeric string rather than crashing or fabricating 0", () => {
    expect(toNumberOrNull("")).toBeNull();
    expect(toNumberOrNull("TBD")).toBeNull();
  });
});

describe("toIntOrZero", () => {
  it("defaults an unparseable value to 0 (used only for standings columns that must be a number)", () => {
    expect(toIntOrZero(null)).toBe(0);
    expect(toIntOrZero("not-a-number")).toBe(0);
  });

  it("passes a real value through", () => {
    expect(toIntOrZero("42")).toBe(42);
  });
});

describe("mapTheSportsDbStatus", () => {
  it("maps recognized scheduled/live/halftime/finished/postponed/cancelled/abandoned tokens", () => {
    expect(mapTheSportsDbStatus("NS")).toBe("scheduled");
    expect(mapTheSportsDbStatus("Not Started")).toBe("scheduled");
    expect(mapTheSportsDbStatus("1H")).toBe("live");
    expect(mapTheSportsDbStatus("Live")).toBe("live");
    expect(mapTheSportsDbStatus("HT")).toBe("halftime");
    expect(mapTheSportsDbStatus("Match Finished")).toBe("finished");
    expect(mapTheSportsDbStatus("FT")).toBe("finished");
    expect(mapTheSportsDbStatus("Postponed")).toBe("postponed");
    expect(mapTheSportsDbStatus("Cancelled")).toBe("cancelled");
    expect(mapTheSportsDbStatus("Suspended")).toBe("abandoned");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(mapTheSportsDbStatus("  match finished  ")).toBe("finished");
  });

  it("maps an empty or null status to unknown rather than guessing from other fields", () => {
    expect(mapTheSportsDbStatus(null)).toBe("unknown");
    expect(mapTheSportsDbStatus("")).toBe("unknown");
    expect(mapTheSportsDbStatus("   ")).toBe("unknown");
  });

  it("maps an unrecognized status to unknown", () => {
    expect(mapTheSportsDbStatus("Q3")).toBe("unknown");
  });
});

describe("parseSeasonYear", () => {
  it("extracts the leading 4-digit year from a YYYY-YYYY season string", () => {
    expect(parseSeasonYear("2024-2025", null)).toBe(2024);
  });

  it("falls back to the fixture's kickoff-date year when strSeason is missing", () => {
    expect(parseSeasonYear(null, "2026-03-14T15:00:00.000Z")).toBe(2026);
  });

  it("falls back to the fixture's kickoff-date year when strSeason is unparseable", () => {
    expect(parseSeasonYear("not-a-season", "2026-03-14T15:00:00.000Z")).toBe(2026);
  });

  it("never throws even with no usable input anywhere", () => {
    expect(() => parseSeasonYear(null, null)).not.toThrow();
    expect(Number.isFinite(parseSeasonYear(null, null))).toBe(true);
  });
});

describe("toTheSportsDbSeasonString", () => {
  it("formats a season year as TheSportsDB's split-year convention", () => {
    expect(toTheSportsDbSeasonString(2024)).toBe("2024-2025");
  });
});

describe("buildEventKickoffIso", () => {
  it("prefers strTimestamp when present and parseable", () => {
    expect(buildEventKickoffIso("2026-01-01", "12:00:00", "2026-03-14T15:00:00.000Z")).toBe(
      "2026-03-14T15:00:00.000Z",
    );
  });

  it("falls back to dateEvent + strTime (as UTC) when no timestamp", () => {
    expect(buildEventKickoffIso("2026-03-14", "15:00:00", null)).toBe("2026-03-14T15:00:00.000Z");
  });

  it("defaults the time-of-day to midnight UTC when strTime is missing", () => {
    expect(buildEventKickoffIso("2026-03-14", null, null)).toBe("2026-03-14T00:00:00.000Z");
  });

  it("never throws when nothing parseable is present, returning a fixed epoch fallback", () => {
    expect(() => buildEventKickoffIso(null, null, null)).not.toThrow();
    expect(buildEventKickoffIso(null, null, null)).toBe(new Date(0).toISOString());
  });
});

function baseEvent(overrides: Partial<TheSportsDbEvent> = {}): TheSportsDbEvent {
  return {
    idEvent: "1001",
    strEvent: "Arsenal vs Chelsea",
    idLeague: "4328",
    strLeague: "English Premier League",
    strSeason: "2025-2026",
    dateEvent: "2026-03-14",
    strTime: "15:00:00",
    strTimestamp: null,
    strStatus: "Match Finished",
    idHomeTeam: "133604",
    idAwayTeam: "133610",
    strHomeTeam: "Arsenal",
    strAwayTeam: "Chelsea",
    intHomeScore: "2",
    intAwayScore: "1",
    idVenue: null,
    strVenue: "Emirates Stadium",
    ...overrides,
  };
}

describe("mapEvent", () => {
  it("maps a well-formed event onto NormalizedFixture correctly", () => {
    const fixture = mapEvent(baseEvent());

    expect(fixture.provider).toBe("thesportsdb");
    expect(fixture.providerId).toBe("1001");
    expect(fixture.competitionProviderId).toBe("4328");
    expect(fixture.competitionName).toBe("English Premier League");
    expect(fixture.season).toBe(2025);
    expect(fixture.status).toBe("finished");
    expect(fixture.homeTeam).toEqual({ providerId: "133604", name: "Arsenal", shortName: null, crestUrl: null });
    expect(fixture.awayTeam).toEqual({ providerId: "133610", name: "Chelsea", shortName: null, crestUrl: null });
    expect(fixture.homeScore).toBe(2);
    expect(fixture.awayScore).toBe(1);
    expect(fixture.venueName).toBe("Emirates Stadium");
    expect(fixture.venueProviderId).toBeNull();
  });

  it("never fabricates a minute or half-time score — always null, per the free-tier limitation", () => {
    const fixture = mapEvent(baseEvent());
    expect(fixture.minute).toBeNull();
    expect(fixture.homeScoreHt).toBeNull();
    expect(fixture.awayScoreHt).toBeNull();
  });

  it("reads a team badge defensively when present, without assuming it always is", () => {
    const withBadge = mapEvent(baseEvent({ strHomeTeamBadge: "https://example.com/arsenal.png" }));
    expect(withBadge.homeTeam.crestUrl).toBe("https://example.com/arsenal.png");

    const withoutBadge = mapEvent(baseEvent());
    expect(withoutBadge.homeTeam.crestUrl).toBeNull();
  });

  it("degrades gracefully on missing team/league fields rather than crashing", () => {
    const fixture = mapEvent(
      baseEvent({ idLeague: null, strLeague: null, idHomeTeam: null, strHomeTeam: null }),
    );
    expect(fixture.competitionProviderId).toBe("");
    expect(fixture.competitionName).toBe("Unknown competition");
    expect(fixture.homeTeam.providerId).toBe("");
    expect(fixture.homeTeam.name).toBe("Unknown");
  });
});
