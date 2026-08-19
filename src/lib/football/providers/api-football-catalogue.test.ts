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

/**
 * The three Details-tab facts the adapter used to drop.
 *
 * All three arrive on the SAME `/fixtures` payload KIVO already pays for.
 * `referee` and `venue.city` were not declared on the response interface at
 * all; `league.round` was declared but only `parseMatchday` ran over it, which
 * extracts a number and correctly returns null for "Quarter-finals" — so for
 * every cup tie the one string naming the round was parsed, found to contain
 * no number, and thrown away.
 */
describe("fixture details depth", () => {
  function fixtureResponse(overrides: Record<string, unknown> = {}) {
    return {
      response: [
        {
          fixture: {
            id: 1001,
            date: "2026-08-15T15:00:00+00:00",
            status: { short: "NS", elapsed: null },
            venue: { id: 556, name: "Old Trafford", city: "Manchester" },
            referee: "Michael Oliver, England",
            ...overrides,
          },
          league: { id: 39, name: "Premier League", season: 2026, country: "England", round: "Regular Season - 12" },
          teams: { home: { id: 33, name: "Manchester United", logo: null }, away: { id: 40, name: "Liverpool", logo: null } },
          goals: { home: null, away: null },
          score: { halftime: { home: null, away: null } },
        },
      ],
    };
  }

  it("keeps the referee, the venue city and the round label", async () => {
    respondWith(fixtureResponse());
    const [fixture] = await (await makeProvider()).getFixturesByDate("2026-08-15");

    expect(fixture.referee).toBe("Michael Oliver, England");
    expect(fixture.venueCity).toBe("Manchester");
    expect(fixture.roundLabel).toBe("Regular Season - 12");
  });

  it("keeps the round label AND the parsed number — neither replaces the other", async () => {
    respondWith(fixtureResponse());
    const [fixture] = await (await makeProvider()).getFixturesByDate("2026-08-15");
    expect(fixture.matchday).toBe(12);
    expect(fixture.roundLabel).toBe("Regular Season - 12");
  });

  it("keeps a cup round's label even though it parses to no matchday", async () => {
    // The regression that made the column necessary. `matchday` is null here
    // and correctly so — 16 is a count of teams, not a matchday — and without
    // the label a quarter-final could not say which round it was.
    const body = fixtureResponse();
    body.response[0].league.round = "Round of 16";
    respondWith(body);

    const [fixture] = await (await makeProvider()).getFixturesByDate("2026-08-15");
    expect(fixture.matchday).toBeNull();
    expect(fixture.roundLabel).toBe("Round of 16");
  });

  it("reports null, not an empty string, when the provider omits them", async () => {
    // Null means "the provider did not say". An empty string would render as a
    // blank Referee row, which is a claim about the match.
    const body = fixtureResponse({ referee: null, venue: { id: 556, name: "Old Trafford", city: null } });
    body.response[0].league.round = "   ";
    respondWith(body);

    const [fixture] = await (await makeProvider()).getFixturesByDate("2026-08-15");
    expect(fixture.referee).toBeNull();
    expect(fixture.venueCity).toBeNull();
    expect(fixture.roundLabel).toBeNull();
  });

  it("survives a payload with the fields absent entirely", async () => {
    // A provider response that predates these fields, or a plan that omits
    // them, must map to null rather than throwing.
    const body = fixtureResponse();
    delete (body.response[0].fixture as Record<string, unknown>).referee;
    delete (body.response[0].fixture.venue as Record<string, unknown>).city;
    respondWith(body);

    const [fixture] = await (await makeProvider()).getFixturesByDate("2026-08-15");
    expect(fixture.referee).toBeNull();
    expect(fixture.venueCity).toBeNull();
    expect(fixture.venueName).toBe("Old Trafford");
  });
});

/**
 * The three standings fields the adapter used to drop.
 *
 * These are what let a league table draw the lines that make it football —
 * the Champions League places, the relegation zone — WITHOUT KIVO asserting
 * anything. The zone is the provider's own statement about its own
 * competition. The alternative on the table was hardcoding "Premier League top
 * four qualify for the Champions League", which is an unverifiable claim with
 * an expiry date and exactly what this product must not do.
 */
describe("standings zone, group and form", () => {
  function standingsResponse(rows: unknown[]) {
    return { response: [{ league: { id: 39, season: 2024, standings: [rows] } }] };
  }

  const ROW = {
    rank: 1,
    team: { id: 33, name: "Manchester United", logo: null },
    points: 23,
    description: "Promotion - Champions League (Group Stage)",
    group: "Premier League",
    form: "WWDLW",
    all: { played: 10, win: 7, draw: 2, lose: 1, goals: { for: 20, against: 8 } },
  };

  it("keeps the provider's own zone phrase, verbatim", async () => {
    respondWith(standingsResponse([ROW]));
    const [row] = await (await makeProvider()).getStandings("39", 2024);

    // Verbatim: not parsed into an enum, not shortened, not classified. Any
    // "colour this green" decision belongs downstream, over data left intact.
    expect(row.zoneDescription).toBe("Promotion - Champions League (Group Stage)");
    expect(row.groupLabel).toBe("Premier League");
    expect(row.form).toBe("WWDLW");
  });

  it("reports null for a row the provider says nothing about", async () => {
    // The common case — most rows in most tables carry no zone. Null must not
    // become an empty string, which a renderer could show as a blank zone chip
    // and read as mid-table safety asserted rather than absent.
    respondWith(standingsResponse([{ ...ROW, description: null, group: null, form: null }]));
    const [row] = await (await makeProvider()).getStandings("39", 2024);

    expect(row.zoneDescription).toBeNull();
    expect(row.groupLabel).toBeNull();
    expect(row.form).toBeNull();
  });

  it("survives a response with the fields absent entirely", async () => {
    const bare = { ...ROW } as Record<string, unknown>;
    delete bare.description;
    delete bare.group;
    delete bare.form;
    respondWith(standingsResponse([bare]));

    const [row] = await (await makeProvider()).getStandings("39", 2024);
    expect(row.zoneDescription).toBeNull();
    expect(row.rank).toBe(1);
    expect(row.points).toBe(23);
  });

  it("treats whitespace as nothing said", async () => {
    respondWith(standingsResponse([{ ...ROW, description: "   ", group: "", form: " " }]));
    const [row] = await (await makeProvider()).getStandings("39", 2024);
    expect(row.zoneDescription).toBeNull();
    expect(row.groupLabel).toBeNull();
    expect(row.form).toBeNull();
  });

  it("keeps each group's rows distinguishable in a group-stage competition", async () => {
    // Without groupLabel a Champions League group stage renders as one
    // 32-row ladder, because `rank` restarts at 1 in every group.
    respondWith({
      response: [
        {
          league: {
            id: 2,
            season: 2024,
            standings: [
              [{ ...ROW, rank: 1, group: "Group A", team: { id: 1, name: "A1", logo: null } }],
              [{ ...ROW, rank: 1, group: "Group B", team: { id: 2, name: "B1", logo: null } }],
            ],
          },
        },
      ],
    });

    const rows = await (await makeProvider()).getStandings("2", 2024);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.groupLabel)).toEqual(["Group A", "Group B"]);
    expect(rows.map((r) => r.rank)).toEqual([1, 1]);
  });
});
