import { formatNumber } from "@/lib/format";

/**
 * How much of KIVO search can actually find, said in real numbers.
 *
 * "No matches for X" is the correct answer to a typo and the *wrong* answer to
 * an index with two clubs in it — in the second case the user has learned
 * nothing, and the honest explanation is not "try another spelling", it is
 * "KIVO has 2 clubs and 0 players synced so far". Search on this product is a
 * window onto whatever has been synced, and the empty state should say so with
 * the same counted-or-nothing vocabulary /discover and /transparency already
 * use, rather than implying the corpus is complete and the query was bad.
 *
 * Deliberately counts rather than a verdict: there is no threshold at which
 * search becomes "fine", and a badge reading "limited coverage" would be a
 * judgement KIVO invented. Five numbers the database really returned.
 */
export type SearchCoverage = {
  teams: number;
  players: number;
  competitions: number;
  managers: number;
  venues: number;
};

export function searchCorpusSize(coverage: SearchCoverage): number {
  return coverage.teams + coverage.players + coverage.competitions + coverage.managers + coverage.venues;
}

const NOUNS: { key: keyof SearchCoverage; one: string; many: string }[] = [
  { key: "teams", one: "club", many: "clubs" },
  { key: "players", one: "player", many: "players" },
  { key: "competitions", one: "competition", many: "competitions" },
  { key: "managers", one: "manager", many: "managers" },
  { key: "venues", one: "venue", many: "venues" },
];

/** "2 clubs, 41 players and 1 competition" — omitting anything KIVO has none
 * of, because a list of zeroes reads as a broken page rather than as an
 * honest inventory. Returns null when there is nothing at all to describe, so
 * the caller can say something different rather than print "nothing". */
export function describeSearchCoverage(coverage: SearchCoverage): string | null {
  const parts = NOUNS.filter((noun) => coverage[noun.key] > 0).map(
    (noun) => `${formatNumber(coverage[noun.key])} ${coverage[noun.key] === 1 ? noun.one : noun.many}`,
  );

  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The sentence under an empty result, chosen by what is actually in the index
 * rather than by how the query was spelled.
 *
 * Three genuinely different situations, and conflating them is what made the
 * old single line unhelpful:
 *   - nothing synced at all: the query never had a chance;
 *   - a thin index: the number itself is the explanation;
 *   - a full index: this really does look like a spelling or a gap.
 */
export function searchEmptyExplanation(coverage: SearchCoverage): string {
  const described = describeSearchCoverage(coverage);
  if (!described) {
    return "Nothing has been synced into KIVO yet, so there is nothing to search. This is an empty database, not a broken search.";
  }
  const total = searchCorpusSize(coverage);
  if (total < THIN_CORPUS) {
    return `KIVO has only ${described} synced so far — search covers exactly that and nothing more. It is not missing; it has not landed yet.`;
  }
  return `KIVO searches ${described}. If a club is missing, it has not been synced yet.`;
}

/**
 * Below this many rows across all five searchable tables, an empty result is
 * far more likely to be a coverage gap than a typo, and the copy switches to
 * saying so. Set where it is because a real competition brings roughly twenty
 * clubs with it: an index smaller than one division is unambiguously partial.
 */
export const THIN_CORPUS = 20;
