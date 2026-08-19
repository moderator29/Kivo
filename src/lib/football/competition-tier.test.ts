import { describe, it, expect } from "vitest";
import {
  rankCompetitionGroups,
  annotateCompetitionGroups,
  NO_COMPETITION_RANKING_SIGNALS,
  type CompetitionRankingSignals,
} from "./competition-tier";
import type { CompetitionGroup } from "./group-by-competition";

type Fixture = { id: string };

function group(id: string | null, name: string | null, fixtures = 1): CompetitionGroup<Fixture> {
  return {
    competitionId: id,
    competitionName: name,
    fixtures: Array.from({ length: fixtures }, (_, i) => ({ id: `${id ?? "unnamed"}-${i}` })),
  };
}

function signals(overrides: Partial<CompetitionRankingSignals> = {}): CompetitionRankingSignals {
  return { ...NO_COMPETITION_RANKING_SIGNALS, ...overrides };
}

const names = (groups: CompetitionGroup<Fixture>[]) => groups.map((g) => g.competitionName);

describe("rankCompetitionGroups", () => {
  it("changes nothing when KIVO has no signals at all", () => {
    // The live database's condition for parts of this: no follows yet, and an
    // unfiltered pipeline. Kickoff order must survive intact rather than being
    // replaced by an arbitrary one.
    const groups = [group("a", "III Liga - Group 2"), group("b", "UEFA Champions League"), group("c", "Reserve League")];
    expect(names(rankCompetitionGroups(groups, NO_COMPETITION_RANKING_SIGNALS))).toEqual([
      "III Liga - Group 2",
      "UEFA Champions League",
      "Reserve League",
    ]);
  });

  it("puts the configured coverage scope above whatever kicked off first", () => {
    const groups = [group("third", "III Liga - Group 2"), group("ucl", "UEFA Champions League")];
    const ranked = rankCompetitionGroups(
      groups,
      signals({
        scopeProviderIds: ["39", "140", "2"],
        providerIdByCompetitionId: new Map([
          ["ucl", "2"],
          ["third", "782"],
        ]),
      }),
    );
    expect(names(ranked)).toEqual(["UEFA Champions League", "III Liga - Group 2"]);
  });

  it("orders inside the coverage tier by the operator's own configured order", () => {
    // The shipped default is the five European domestic leagues followed by the
    // continental cups, so a default deployment reads top-five-first — without
    // this file knowing what a top five league is. An operator who puts the
    // NPFL first gets the NPFL first, with no code change.
    const groups = [group("ucl", "UEFA Champions League"), group("epl", "Premier League"), group("laliga", "La Liga")];
    const ranked = rankCompetitionGroups(
      groups,
      signals({
        scopeProviderIds: ["39", "140", "135", "78", "61", "2", "3"],
        providerIdByCompetitionId: new Map([
          ["ucl", "2"],
          ["epl", "39"],
          ["laliga", "140"],
        ]),
      }),
    );
    expect(names(ranked)).toEqual(["Premier League", "La Liga", "UEFA Champions League"]);
  });

  it("pins the viewer's own favourites above everything, including the coverage scope", () => {
    const groups = [group("epl", "Premier League"), group("npfl", "Nigeria Professional Football League")];
    const ranked = rankCompetitionGroups(
      groups,
      signals({
        favouriteCompetitionIds: new Set(["npfl"]),
        scopeProviderIds: ["39"],
        providerIdByCompetitionId: new Map([["epl", "39"]]),
      }),
    );
    expect(names(ranked)).toEqual(["Nigeria Professional Football League", "Premier League"]);
    expect(ranked[0].tier).toBe("favourite");
    expect(ranked[1].tier).toBe("covered");
  });

  it("ranks a competition KIVO users follow above one nobody follows", () => {
    const groups = [group("quiet", "Reserve League"), group("popular", "Major League Soccer")];
    const ranked = rankCompetitionGroups(
      groups,
      signals({ followerCountByCompetitionId: new Map([["popular", 4]]) }),
    );
    expect(names(ranked)).toEqual(["Major League Soccer", "Reserve League"]);
    expect(ranked[0].tier).toBe("followed");
    expect(ranked[1].tier).toBe("other");
  });

  it("keeps followed competitions in follower-count order", () => {
    const groups = [group("a", "A"), group("b", "B"), group("c", "C")];
    const ranked = rankCompetitionGroups(
      groups,
      signals({
        followerCountByCompetitionId: new Map([
          ["a", 2],
          ["b", 9],
          ["c", 5],
        ]),
      }),
    );
    expect(names(ranked)).toEqual(["B", "C", "A"]);
  });

  it("is stable: equal signals keep their original relative order", () => {
    const groups = [group("a", "A"), group("b", "B"), group("c", "C")];
    expect(names(rankCompetitionGroups(groups, signals()))).toEqual(["A", "B", "C"]);
  });

  it("never favourites or scopes a group with no competition id", () => {
    // Grouping keeps rows KIVO has no competition id for. There is nothing to
    // write a follows row against, so they can only ever land in "other".
    const annotated = annotateCompetitionGroups(
      [group(null, null)],
      signals({ favouriteCompetitionIds: new Set([""]), scopeProviderIds: ["39"] }),
    );
    expect(annotated[0].tier).toBe("other");
    expect(annotated[0].isFavourite).toBe(false);
    expect(annotated[0].scopeIndex).toBeNull();
    expect(annotated[0].followerCount).toBe(0);
  });

  it("ranks a duplicated scope id where it was first mentioned", () => {
    const groups = [group("b", "B"), group("a", "A")];
    const ranked = rankCompetitionGroups(
      groups,
      signals({
        scopeProviderIds: ["39", "140", "39"],
        providerIdByCompetitionId: new Map([
          ["a", "39"],
          ["b", "140"],
        ]),
      }),
    );
    expect(names(ranked)).toEqual(["A", "B"]);
  });

  it("does not reorder when the pipeline is deliberately unfiltered", () => {
    // getCompetitionScope returns no ordered ids for an unfiltered pipeline.
    // "Everything is in scope" ranks nothing above anything, so kickoff order
    // is the honest answer.
    const groups = [group("third", "III Liga"), group("ucl", "UEFA Champions League")];
    const ranked = rankCompetitionGroups(
      groups,
      signals({
        scopeProviderIds: [],
        providerIdByCompetitionId: new Map([
          ["ucl", "2"],
          ["third", "782"],
        ]),
      }),
    );
    expect(names(ranked)).toEqual(["III Liga", "UEFA Champions League"]);
  });
});
