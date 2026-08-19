import { logError } from "./log";

/**
 * The line between "there is nothing here" and "we could not find out".
 *
 * Every list page in KIVO was written the same way:
 *
 *     const { data } = await supabase.from("teams").select(...);
 *     const rows = data ?? [];
 *     if (rows.length === 0) return <NoDataYet ... />;
 *
 * `data ?? []` is where the two facts collapse into one. PostgREST returns
 * `{ data: null, error }` when the query fails — a dropped connection, an
 * expired token, a schema drift, a rate limit — and the page then renders the
 * *empty* state, which in this product says, in as many words, that KIVO has
 * not synced this competition yet and that nothing is broken. That sentence is
 * false at exactly the moment something is broken, and it is false in the
 * direction that costs the most: the user stops trying, because they have been
 * told there is nothing to wait for.
 *
 * This module is the one place that decision gets made, so it gets made the
 * same way everywhere:
 *
 * - **A list** whose query failed reports `failed`, and the page renders
 *   `<LoadFailed>` — a different screen, with a retry. It does not throw,
 *   because a browse page can usually keep its header and its filters on
 *   screen while one section admits it could not load.
 * - **A single row** whose query failed throws, so the route's `error.tsx`
 *   catches it. The alternative is worse than a crash: these lookups gate
 *   `notFound()`, so a failed read renders "this doesn't exist" about a venue,
 *   a player or a club that exists perfectly well. A 404 is a claim about the
 *   world, not about the request, and it must never be made on a guess.
 *
 * `maybeSingle()` is what makes the second rule safe: it returns
 * `{ data: null, error: null }` for a genuinely absent row and only sets
 * `error` for a real failure, so "absent" and "failed" arrive already
 * separated and this only has to keep them that way. (`single()` treats zero
 * rows as an error and must not be used behind `readRow`.)
 */

/** The shape both PostgREST and the Supabase client return. Structural on
 * purpose — nothing here should need the client's types to be testable. */
export type QueryResult<T> = { data: T | null; error: { message: string } | null };

/**
 * The single-row form, constrained rather than parameterised.
 *
 * `maybeSingle()` is typed as a *union* — `{ data: Row | null; error: null }`
 * or `{ data: null; error: PostgrestError }` — and inferring `T` from
 * `QueryResult<T>` against a union collapses to `never` on the error arm, so
 * every field read off the result then fails to compile at the call site.
 * Constraining the whole result and projecting `R["data"]` distributes over the
 * union properly and recovers the real row type.
 */
type RowResult = { data: unknown; error: { message: string } | null };

/** Raised when a read fails, as opposed to returning nothing. Named so it is
 * greppable in logs and unmistakable in a stack trace. */
export class QueryFailedError extends Error {
  constructor(
    /** Where it happened, e.g. "venues.detail". Matches the `logError` tag. */
    readonly context: string,
    reason: string,
  ) {
    super(`Query failed (${context}): ${reason}`);
    this.name = "QueryFailedError";
  }
}

export type ListOutcome<T> =
  /** The query ran. `rows` is what there is, and an empty array genuinely
   * means there is nothing. */
  | { failed: false; rows: T[] }
  /** The query did not run to completion. How many rows exist is unknown, and
   * the caller must not claim it is zero. */
  | { failed: true; rows: never[]; reason: string };

/**
 * Reads a list query, keeping "empty" and "failed" apart.
 *
 * The failure is logged here rather than at each call site, so a page that
 * renders `<LoadFailed>` always leaves a structured trace behind it — an
 * error state a user can see but an operator cannot find is only half a
 * feature.
 */
export function readList<T>(result: QueryResult<T[]>, context: string): ListOutcome<T> {
  if (result.error) {
    logError(`query.${context}`, new QueryFailedError(context, result.error.message));
    return { failed: true, rows: [], reason: result.error.message };
  }
  return { failed: false, rows: result.data ?? [] };
}

/**
 * Reads a single-row lookup, throwing when it failed and returning `null` only
 * when the row is genuinely absent.
 *
 * Pair with `maybeSingle()`, and call `notFound()` on the `null` — that is then
 * a fact rather than an assumption.
 */
export function readRow<R extends RowResult>(result: R, context: string): NonNullable<R["data"]> | null {
  if (result.error) {
    const failure = new QueryFailedError(context, result.error.message);
    logError(`query.${context}`, failure);
    throw failure;
  }
  return (result.data ?? null) as NonNullable<R["data"]> | null;
}

/**
 * `readRow` for a lookup whose failure must not take the page down — a
 * `generateMetadata` call, or a secondary panel beside content that is already
 * on screen. Returns `null` for both outcomes, having logged the failure, and
 * is deliberately named so that choosing it over `readRow` is visible in
 * review rather than implied by a missing `error` in a destructure.
 */
export function readOptionalRow<R extends RowResult>(result: R, context: string): NonNullable<R["data"]> | null {
  if (result.error) {
    logError(`query.${context}`, new QueryFailedError(context, result.error.message));
    return null;
  }
  return (result.data ?? null) as NonNullable<R["data"]> | null;
}
