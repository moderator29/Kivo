import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

/**
 * The competition allowlist's behaviour, pinned.
 *
 * This module decides what the entire fixture pipeline is allowed to write, so
 * a mistake here is not a wrong number on a screen — it is a database that
 * silently fills with the wrong football, or with none. Three properties are
 * worth a test each, and all three are ones a well-meaning future edit could
 * plausibly break:
 *
 *  1. **Unset means the shipped default, and only for API-Football.** The
 *     default list is API-Football's own numbering; applying it to another
 *     provider's ids would filter that provider's response against numbers that
 *     mean something else, and the likeliest outcome is an empty sync that
 *     looks like an outage.
 *  2. **`all` really means no filter.** The behaviour this module had before a
 *     default existed has to stay reachable, or shipping a default is a
 *     one-way door.
 *  3. **A blank/comma-only var falls back rather than producing an empty
 *     allowlist.** An empty Set would scope every sync down to nothing and
 *     present to the founder as "there is no football" — the single worst
 *     failure mode available to this file.
 */

const ORIGINAL = process.env.FOOTBALL_SYNC_COMPETITION_IDS;

// `server-only` throws when imported outside a server component graph; the
// module under test is a pure function and has no server dependency beyond that
// import.
vi.mock("server-only", () => ({}));

async function load() {
  vi.resetModules();
  return import("./competitions-config");
}

beforeEach(() => {
  delete process.env.FOOTBALL_SYNC_COMPETITION_IDS;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.FOOTBALL_SYNC_COMPETITION_IDS;
  else process.env.FOOTBALL_SYNC_COMPETITION_IDS = ORIGINAL;
});

describe("getCompetitionScope", () => {
  it("uses the shipped default for api-football when the var is unset", async () => {
    const { getCompetitionScope, DEFAULT_API_FOOTBALL_COMPETITIONS } = await load();
    const scope = getCompetitionScope("api-football");

    expect(scope.source).toBe("default");
    expect(scope.orderedIds).toEqual(DEFAULT_API_FOOTBALL_COMPETITIONS.map((c) => c.providerId));
    expect(scope.providerIds?.has("39")).toBe(true);
  });

  it("applies no filter for a provider KIVO has no vetted list for", async () => {
    const { getCompetitionScope } = await load();
    const scope = getCompetitionScope("thesportsdb");

    // Deliberately NOT the api-football default: those ids are API-Football's
    // numbering and mean something else under TheSportsDB's idLeague values.
    expect(scope.source).toBe("unfiltered");
    expect(scope.providerIds).toBeNull();
  });

  it("treats FOOTBALL_SYNC_COMPETITION_IDS=all as no filter at all", async () => {
    process.env.FOOTBALL_SYNC_COMPETITION_IDS = "all";
    const { getCompetitionScope, getSyncedCompetitionProviderIds } = await load();

    expect(getCompetitionScope("api-football").source).toBe("unfiltered");
    expect(getSyncedCompetitionProviderIds("api-football")).toBeNull();
  });

  it("honours an explicit list, trimming and dropping blanks", async () => {
    process.env.FOOTBALL_SYNC_COMPETITION_IDS = " 332 , ,  71 ";
    const { getCompetitionScope } = await load();
    const scope = getCompetitionScope("api-football");

    expect(scope.source).toBe("env");
    expect(scope.orderedIds).toEqual(["332", "71"]);
    expect(scope.providerIds?.has("39")).toBe(false);
  });

  it("falls back to the default rather than producing an empty allowlist", async () => {
    process.env.FOOTBALL_SYNC_COMPETITION_IDS = " , , ";
    const { getCompetitionScope } = await load();
    const scope = getCompetitionScope("api-football");

    // An empty Set here would scope every sync to nothing and read, on the
    // product, as "there is no football".
    expect(scope.source).toBe("default");
    expect(scope.orderedIds.length).toBeGreaterThan(0);
  });
});

describe("the shipped default list", () => {
  it("carries a provenance claim for every id, and no duplicates", async () => {
    const { DEFAULT_API_FOOTBALL_COMPETITIONS } = await load();

    const ids = DEFAULT_API_FOOTBALL_COMPETITIONS.map((c) => c.providerId);
    expect(new Set(ids).size).toBe(ids.length);

    for (const competition of DEFAULT_API_FOOTBALL_COMPETITIONS) {
      // Every entry states what KIVO believes the id is, which is what the
      // admin panel checks against the provider's own registry. An entry with
      // no expectation cannot be verified by anyone.
      expect(competition.expectedName.length).toBeGreaterThan(0);
      expect(competition.expectedCountry.length).toBeGreaterThan(0);
      expect(competition.providerId).toMatch(/^\d+$/);
    }
  });
});
