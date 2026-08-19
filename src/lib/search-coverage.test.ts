import { describe, expect, it } from "vitest";
import {
  describeSearchCoverage,
  searchCorpusSize,
  searchEmptyExplanation,
  THIN_CORPUS,
  type SearchCoverage,
} from "./search-coverage";

const empty: SearchCoverage = { teams: 0, players: 0, competitions: 0, managers: 0, venues: 0 };

describe("describeSearchCoverage", () => {
  it("omits everything KIVO has none of rather than listing zeroes", () => {
    expect(describeSearchCoverage({ ...empty, teams: 2, players: 41 })).toBe("2 clubs and 41 players");
  });

  it("singularises a count of one", () => {
    expect(describeSearchCoverage({ ...empty, teams: 1 })).toBe("1 club");
  });

  it("says nothing at all when there is nothing to describe", () => {
    expect(describeSearchCoverage(empty)).toBeNull();
  });
});

describe("searchEmptyExplanation", () => {
  it("tells an empty database apart from a failed search", () => {
    expect(searchEmptyExplanation(empty)).toContain("not a broken search");
  });

  it("blames the thin index, not the speller, when the index really is thin", () => {
    // The coordinator's case: under two synced clubs, an empty result must
    // explain itself with the real number.
    const explanation = searchEmptyExplanation({ ...empty, teams: 1, competitions: 1 });
    expect(explanation).toContain("1 club");
    expect(explanation).toContain("has not landed yet");
  });

  it("stops apologising once the index is a real one", () => {
    const explanation = searchEmptyExplanation({ ...empty, teams: 20, players: 400 });
    expect(explanation).toContain("has not been synced yet");
    expect(explanation).not.toContain("only");
  });
});

describe("searchCorpusSize", () => {
  it("counts every searchable table, because search does", () => {
    expect(searchCorpusSize({ teams: 1, players: 2, competitions: 3, managers: 4, venues: 5 })).toBe(15);
    expect(THIN_CORPUS).toBeGreaterThan(0);
  });
});
