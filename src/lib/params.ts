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

/**
 * How many pages of an offset-paginated list a single URL may ask for (KN-47).
 *
 * `?page=N` on these lists means "N pages loaded", cumulative, because that is
 * what a "Load more" button actually produces — so the number is also a
 * multiplier on the row count, and an unclamped one would let `?page=99999`
 * ask a page for six million rows. 25 pages is far past any real session and
 * still bounded.
 */
export const MAX_LIST_PAGES = 25;

/**
 * Reads the cumulative page count out of a list URL (KN-47).
 *
 * Every long list in the app kept its loaded offset in React state, and the
 * `(app)` group is `force-dynamic` — so tapping a post and pressing Back
 * re-rendered page one, and a user who had paged through five times lost all
 * of it. The offset belongs in the URL, where the browser's own history
 * already knows how to restore it, and where it can be shared and bookmarked.
 *
 * Anything malformed, negative, fractional or absurd resolves to 1 rather than
 * erroring: a bad `?page=` is a URL somebody typed or truncated, not an
 * exceptional condition.
 */
export function resolveListPage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 1;
  const page = Math.trunc(parsed);
  if (page < 1) return 1;
  return Math.min(page, MAX_LIST_PAGES);
}
