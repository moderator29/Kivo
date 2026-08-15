/**
 * Escapes ilike/like's special characters (`%`, `_`) and its own escape
 * character (`\`) so a search term containing them is matched literally
 * instead of silently altering the pattern — e.g. a user searching for "50%"
 * or "under_18" shouldn't accidentally turn part of their own query into a
 * wildcard, and a string of bare `%` characters shouldn't be able to force
 * an expensive scan (RECOMMENDATIONS item 39).
 *
 * Postgres's ilike/like default escape character is already `\`, so nothing
 * beyond escaping these three characters in the input is required before
 * interpolating it into a `%${...}%` pattern.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
