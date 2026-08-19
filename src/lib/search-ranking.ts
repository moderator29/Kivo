/**
 * What makes KIVO's search forgiving, and what makes it fast to read.
 *
 * Search was one substring test: `name ilike '%<whatever you typed>%'`, with
 * whatever five rows the database happened to return first. That is exact
 * enough to be useless in football, for two reasons a fan meets immediately.
 *
 * **Word order and the words in between.** Nobody types a club's registered
 * name. They type "man united", "spurs", "inter milan", "bayern munich" — and
 * "man united" does not appear as a substring of "Manchester United", so the
 * one club in England most people search for returned nothing at all. Treating
 * the query as a set of words that must each appear somewhere fixes that
 * without loosening anything else: every word still has to be there, so
 * "united" alone does not start matching Manchester City.
 *
 * **Relevance.** With a substring test, "ars" matches "Arsenal", "Arsenal U21"
 * and "Sporting Arsenal" equally, and a `limit 5` with no ordering means which
 * three of them you see is arbitrary. So the tiers below: an exact name first,
 * then a name that starts with what you typed, then a name where your words
 * start a word, then anywhere at all — and within a tier, the shorter name,
 * because a shorter name containing your query is more likely to BE the thing
 * you meant than a longer one that merely contains it.
 *
 * Everything here is pure and works on names the database already returned, so
 * it costs no extra query and can be tested directly. Nothing in it invents,
 * reorders or hides a fact — it only decides which of several real rows a
 * reader is shown first.
 */

/**
 * At most this many words are taken from a query. Each one becomes another
 * `ilike` on the same column, and a bound keeps a pasted paragraph from
 * turning into a fifty-clause filter.
 */
export const MAX_QUERY_TERMS = 4;

/**
 * The words a query is searched for, lowercased and de-duplicated.
 *
 * Splitting on whitespace only, and deliberately not on punctuation:
 * "Brighton & Hove" and "M'Gladbach" carry their punctuation in the real name
 * too, so treating an apostrophe as a separator would search for words that
 * are not in anyone's name.
 */
export function queryTerms(query: string): string[] {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  return [...new Set(terms)].slice(0, MAX_QUERY_TERMS);
}

/**
 * How well a name answers a query. Lower sorts first.
 *
 * Ordered so that every tier is a strictly stronger claim than the one below
 * it, which is what lets a reader trust the top result without reading the
 * rest of the list.
 */
export function relevanceRank(name: string, query: string): number {
  const haystack = name.trim().toLowerCase();
  const needle = query.trim().toLowerCase();
  if (haystack.length === 0 || needle.length === 0) return 5;

  if (haystack === needle) return 0;
  if (haystack.startsWith(needle)) return 1;

  const terms = queryTerms(needle);
  // Every word starts a word in the name: "man united" against "Manchester
  // United", "bay mun" against "Bayern Munich". This is the tier that makes
  // the way people actually type club names work.
  if (terms.length > 0 && terms.every((term) => startsAWord(haystack, term))) return 2;
  // The whole phrase appears somewhere, just not at the front.
  if (haystack.includes(needle)) return 3;
  // Every word appears somewhere. The loosest thing the query still supports.
  if (terms.length > 0 && terms.every((term) => haystack.includes(term))) return 4;
  return 5;
}

/** True when `term` begins a word inside `haystack` — the start of the string
 * or immediately after a character that is not a letter or a digit. */
function startsAWord(haystack: string, term: string): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(term, from);
    if (at === -1) return false;
    if (at === 0 || !/[\p{L}\p{N}]/u.test(haystack[at - 1])) return true;
    from = at + 1;
  }
}

/**
 * Sorts rows by how well their name answers the query, then by name length,
 * then alphabetically.
 *
 * Stable in the sense that matters: two rows that are equally good matches and
 * equally long come out in name order, so the same query always produces the
 * same list rather than whatever order the database happened to return.
 */
export function rankByRelevance<T>(rows: T[], query: string, nameOf: (row: T) => string): T[] {
  return [...rows]
    .map((row, index) => ({ row, index, name: nameOf(row) }))
    .sort((left, right) => {
      const byRank = relevanceRank(left.name, query) - relevanceRank(right.name, query);
      if (byRank !== 0) return byRank;
      const byLength = left.name.length - right.name.length;
      if (byLength !== 0) return byLength;
      return left.name.localeCompare(right.name);
    })
    .map(({ row }) => row);
}
