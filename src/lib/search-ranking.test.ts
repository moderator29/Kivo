import { describe, expect, it } from "vitest";
import { MAX_QUERY_TERMS, queryTerms, rankByRelevance, relevanceRank } from "./search-ranking";

describe("queryTerms", () => {
  it("splits on whitespace and lowercases", () => {
    expect(queryTerms("  Man   United ")).toEqual(["man", "united"]);
  });

  it("keeps punctuation, because club names carry it too", () => {
    // Splitting on the apostrophe would search for "gladbach" and "m", neither
    // of which is a word in "Borussia M'gladbach".
    expect(queryTerms("M'gladbach")).toEqual(["m'gladbach"]);
    expect(queryTerms("Brighton & Hove")).toEqual(["brighton", "&", "hove"]);
  });

  it("de-duplicates and caps the number of terms", () => {
    expect(queryTerms("real real madrid")).toEqual(["real", "madrid"]);
    expect(queryTerms("a b c d e f")).toHaveLength(MAX_QUERY_TERMS);
  });
});

describe("relevanceRank", () => {
  it("ranks an exact name above one that merely starts with the query", () => {
    expect(relevanceRank("Arsenal", "arsenal")).toBeLessThan(relevanceRank("Arsenal U21", "arsenal"));
  });

  it("ranks a name that starts with the query above one that contains it", () => {
    expect(relevanceRank("Arsenal U21", "arsenal")).toBeLessThan(relevanceRank("Sporting Arsenal", "arsenal"));
  });

  it("understands the way people actually type club names", () => {
    // The tier this whole module exists for: "man united" is not a substring
    // of "Manchester United", and it is what a fan types.
    expect(relevanceRank("Manchester United", "man united")).toBeLessThan(5);
    expect(relevanceRank("Bayern Munich", "bay mun")).toBeLessThan(5);
  });

  it("still requires every word, so one word does not match a different club", () => {
    expect(relevanceRank("Manchester City", "man united")).toBe(5);
  });

  it("is case and order insensitive", () => {
    expect(relevanceRank("Inter Milan", "MILAN INTER")).toBeLessThan(5);
  });

  it("does not match a word fragment as a word start", () => {
    // "utd" appears nowhere in "Manchester United", and a rank that pretended
    // otherwise would put unrelated clubs above real matches.
    expect(relevanceRank("Manchester United", "utd")).toBe(5);
  });
});

describe("rankByRelevance", () => {
  const named = (...names: string[]) => names.map((name) => ({ name }));

  it("puts the club a reader meant first", () => {
    const ranked = rankByRelevance(
      named("Arsenal U21", "Sporting Arsenal", "Arsenal", "Arsenal Women"),
      "arsenal",
      (row) => row.name,
    );
    expect(ranked[0].name).toBe("Arsenal");
  });

  it("breaks a tie by the shorter name, then alphabetically", () => {
    // Two names equally good as matches: the shorter one is likelier to be the
    // thing itself rather than something that merely contains it.
    const ranked = rankByRelevance(named("Real Madrid Castilla", "Real Madrid"), "real madrid", (row) => row.name);
    expect(ranked.map((row) => row.name)).toEqual(["Real Madrid", "Real Madrid Castilla"]);
  });

  it("orders the same way whatever order the rows arrived in", () => {
    const forwards = rankByRelevance(named("Everton", "Everton FC", "Everton de Vina"), "everton", (r) => r.name);
    const backwards = rankByRelevance(named("Everton de Vina", "Everton FC", "Everton"), "everton", (r) => r.name);
    expect(forwards.map((r) => r.name)).toEqual(backwards.map((r) => r.name));
  });

  it("does not drop a row it cannot rank well", () => {
    // Ranking decides order, never membership. Every row the database returned
    // is still in the list.
    const ranked = rankByRelevance(named("Arsenal", "Chelsea"), "arsenal", (row) => row.name);
    expect(ranked).toHaveLength(2);
  });
});
