import { notFound } from "next/navigation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates a dynamic route param's shape as a UUID before it's safe to
 * interpolate into a raw PostgREST filter-expression string (`.or()`,
 * `.filter()`, `.textSearch()`, etc. all take a hand-built string, unlike
 * `.eq()`/`.ilike()` which pass their value as a bound parameter and need no
 * such check). A malformed value here would only ever error rather than
 * leak anything, but unvalidated input inside a filter-expression string is
 * the wrong default regardless (RECOMMENDATIONS item 40) — calls Next's
 * `notFound()` on a bad shape, same as an id that's well-formed but simply
 * doesn't exist.
 */
export function parseUuidParam(id: string): string {
  if (!UUID_RE.test(id)) notFound();
  return id;
}
