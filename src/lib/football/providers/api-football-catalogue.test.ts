import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The two adapter changes the club catalogue rests on, pinned against
 * regression:
 *
 *  1. **`/teams?league=&season=` normalizes to a club profile.** This is the
 *     endpoint that makes a club directory possible without a fixture, and it is
 *     new, so nothing else would notice if it silently returned nothing.
 *  2. **`league.country` survives the fixture mapping.** It did not, and that
 *     single dropped field is why all 85 competitions in the live database have
 *     a null country and every league renders as "International". A test is
 *     cheap insurance against it being dropped again by the next person who
 *     touches the mapper.
 *
 * Both go through a mocked `requestWithRetry` rather than a mocked global
 * fetch: the retry/classify/quota-header behaviour is already covered by
 * `api-football-request.test.ts`, and what is under test here is only the
 * mapping from the provider's JSON to KIVO's shapes.
 */

vi.mock("server-only", () => ({}));

const requestWithRetry = vi.fn();

vi.mock("./api-football-request", async () => {
  const actual = await vi.importActual<typeof import("./api-football-request")>("./api-football-request");
  return { ...actual, requestWithRetry: (...args: unknown[]) => requestWithRetry(...args) };
});

function respondWith(body: unknown) {
  requestWithRetry.mockResolvedValue({
    response: { ok: true, status: 200, json: async () => body } as unknown as Response,
    quotaRemaining: 42,
  });
}

async function makeProvider() {
  const { ApiFootballProvider } = await import("./api-football");
  return new ApiFootballProvider("test-key");
}

beforeEach(() => {
  requestWithRetry.mockReset();
});

describe("getTeamsByLeague", () => {
  it("maps a league's clubs, including the fields /fixtures can never supply", async () => {
    respondWith({
      response: [
        {
          team: { id: 541, name: "Real Madrid", code: "MAD", country: "Spain", founded: 1902, logo: "crest.png" },
          venue: { id: 1456, name: "Estadio Santiago Bernabéu", city: "Madrid" },
        },
      ],
    });

    const provider = await makeProvider();
    const clubs = await provider.getTeamsByLeague("140", 2025);

    expect(clubs).toEqual([
      {
        providerId: "541",
        name: "Real Madrid",
        shortName: "MAD",
        crestUrl: "crest.png",
        country: "Spain",
        founded: 1902,
        venueProviderId: "1456",
        venueName: "Estadio Santiago Bernabéu",
        venueCity: "Madrid",
      },
    ]);

    // The whole league, for one request, scoped to the season asked for.
    const [{ path }] = requestWithRetry.mock.calls[0] as [{ path: string }];
    expect(path).toBe("/teams?league=140&season=2025");
  });

  it("normalizes missing optional fields to null rather than inventing them", async () => {
    respondWith({ response: [{ team: { id: 7, name: "Enyimba" }, venue: null }] });

    const provider = await makeProvider();
    const [club] = await provider.getTeamsByLeague("332", 2025);

    expect(club.shortName).toBeNull();
    expect(club.country).toBeNull();
    expect(club.founded).toBeNull();
    expect(club.venueProviderId).toBeNull();
    expect(club.venueCity).toBeNull();
  });

  it("skips a club with no id or no name rather than writing a placeholder", async () => {
    respondWith({
      response: [
        { team: { id: null, name: "Nameless id" } },
        { team: { id: 9, name: null } },
        { team: { id: 10, name: "Real club" } },
      ],
    });

    const provider = await makeProvider();
    const clubs = await provider.getTeamsByLeague("39", 2025);

    // A row named "Unknown" in the club directory is worse than a row that is
    // not there — it cannot be mapped, corrected or searched for.
    expect(clubs.map((c) => c.name)).toEqual(["Real club"]);
  });

  it("reports an empty league as an empty array, not as a failure", async () => {
    respondWith({ response: [] });

    const provider = await makeProvider();
    await expect(provider.getTeamsByLeague("39", 2099)).resolves.toEqual([]);
  });
});

describe("competition country on fixtures", () => {
  const fixtureItem = {
    fixture: {
      id: 1,
      date: "2026-08-19T18:00:00+00:00",
      status: { short: "NS", elapsed: null },
      venue: { id: 5, name: "Ground" },
    },
    league: { id: 39, name: "Premier League", season: 2025, country: "England", round: "Regular Season - 1" },
    teams: { home: { id: 1, name: "A", logo: null }, away: { id: 2, name: "B", logo: null } },
    goals: { home: null, away: null },
    score: { halftime: { home: null, away: null } },
  };

  it("carries league.country through getFixturesByDate", async () => {
    respondWith({ response: [fixtureItem] });

    const provider = await makeProvider();
    const [fixture] = await provider.getFixturesByDate("2026-08-19");

    expect(fixture.competitionCountry).toBe("England");
  });

  it("carries it through getFixtureById too, which used to hold a diverged copy of the mapping", async () => {
    respondWith({ response: [fixtureItem] });

    const provider = await makeProvider();
    const fixture = await provider.getFixtureById("1");

    expect(fixture?.competitionCountry).toBe("England");
  });

  it("leaves country null when the provider omits it, never guessing from the name", async () => {
    respondWith({ response: [{ ...fixtureItem, league: { id: 39, name: "Premier League", season: 2025 } }] });

    const provider = await makeProvider();
    const [fixture] = await provider.getFixturesByDate("2026-08-19");

    expect(fixture.competitionCountry).toBeNull();
  });
});

describe("getCompetitionCoverage", () => {
  it("carries the country, type and badge the /leagues response already paid for", async () => {
    respondWith({
      response: [
        {
          league: { id: 39, name: "Premier League", type: "League", logo: "badge.png" },
          country: { name: "England", code: "GB", flag: "flag.svg" },
          seasons: [{ year: 2025, coverage: { standings: true, players: true } }],
        },
      ],
    });

    const provider = await makeProvider();
    const [row] = await provider.getCompetitionCoverage(2025);

    expect(row.competitionCountry).toBe("England");
    expect(row.competitionType).toBe("League");
    expect(row.competitionLogoUrl).toBe("badge.png");
    // Unchanged behaviour, asserted so the country addition cannot quietly
    // break what this endpoint was already trusted for.
    expect(row.standings).toBe(true);
    expect(row.players).toBe(true);
    expect(row.odds).toBeNull();
  });
});
