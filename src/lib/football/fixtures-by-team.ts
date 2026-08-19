/**
 * Fetching "fixtures involving any of these teams" without building a filter
 * string that grows with the follow count (KIVO_NEXT_GEN KN-15).
 *
 * `/home` built its followed-team filter as
 * `.or(ids.map((id) => `home_team_id.eq.${id},away_team_id.eq.${id}`).join(","))`
 * — roughly 100 URL-encoded characters per followed team, in a GET query
 * string. A user following a hundred clubs produces a filter well past what
 * proxies and PostgREST accept, and it fails as an opaque request error rather
 * than degrading: the page's whole "your teams" section disappears with no
 * indication why, and it fails *harder the more engaged the user is*, which is
 * the worst possible direction for a bug like this to point.
 *
 * The fix is structural rather than a shorter string. Two things:
 *
 *  1. **Chunked.** Any single-request approach is still linear in the follow
 *     count; chunking makes the per-request length a constant the code chooses
 *     rather than something a user's behaviour decides. Chunks run in parallel,
 *     so a heavy follower costs concurrency, not latency.
 *  2. **Plain `.in()`, never `.or()`.** A team can be the home side or the away
 *     side, which is what tempted the original `.or()`. Two straightforward
 *     `.in()` queries per chunk express the same thing with no nested filter
 *     grammar at all — half the URL length, and nothing that can be subtly
 *     mis-parsed.
 *
 * Merging sorted prefixes is exact, not approximate: each sub-query returns its
 * own earliest `limit` fixtures in kickoff order, so the earliest `limit` of the
 * union is guaranteed to be inside the union of those prefixes.
 */

/**
 * How many team ids go into one `.in()` filter. 30 uuids is roughly 1.2KB of
 * URL — comfortably inside every proxy and server default, with room for the
 * select list and the other filters that ride along with it.
 */
export const TEAM_ID_CHUNK_SIZE = 30;

export function chunkTeamIds(teamIds: readonly string[], size: number = TEAM_ID_CHUNK_SIZE): string[][] {
  const unique = [...new Set(teamIds)];
  const out: string[][] = [];
  for (let i = 0; i < unique.length; i += size) out.push(unique.slice(i, i + size));
  return out;
}

/**
 * Runs `query` once per (chunk × side) and merges the results.
 *
 * `query` is a callback rather than a Supabase builder so this module stays
 * pure and unit-testable, and so each caller keeps its own `select`, date range
 * and status filters without this function needing to know about any of them.
 * The callback must apply the same `order("kickoff_at", …)` direction and the
 * same `limit` the caller wants overall — see the merge argument above for why
 * that is exact rather than a heuristic.
 *
 * `order` exists because both directions are genuinely wanted: "the next N
 * fixtures" (ascending, /home) and "the last N results" (descending, the
 * watchlist digest). The merge argument is symmetric — the latest N of the
 * union is necessarily inside the union of the latest-N prefixes, exactly as
 * the earliest N is.
 */
/**
 * The outcome of a chunked fetch, keeping "there are none" and "we could not
 * find out" apart — the same distinction `readList` draws in
 * src/lib/query-result.ts, and it matters more here than almost anywhere.
 *
 * This function issues 2N requests and merges them. `data ?? []` per response
 * meant a single failed chunk was silently dropped from the merge, and the
 * caller received a *shorter list that looked complete*. That is worse than
 * the empty-vs-failed collapse everywhere else in the codebase: an empty list
 * at least announces itself, whereas nine fixtures where there should be
 * twelve looks exactly like nine fixtures. And it degrades in the same cruel
 * direction the `.or()` bug did — more followed clubs means more chunks, so
 * the most engaged user is the likeliest to be quietly under-served.
 *
 * `failed` is therefore true if **any** sub-query failed, and `rows` carries
 * whatever did come back so a caller that genuinely prefers partial data can
 * still opt into it deliberately. Neither current caller does.
 */
export type TeamFixturesOutcome<Row> = { failed: boolean; rows: Row[] };

export async function fetchFixturesForTeams<Row extends { id: string; kickoff_at: string }>(
  teamIds: readonly string[],
  limit: number,
  query: (
    column: "home_team_id" | "away_team_id",
    ids: string[],
  ) => PromiseLike<{ data: Row[] | null; error?: { message: string } | null }>,
  order: "asc" | "desc" = "asc",
): Promise<TeamFixturesOutcome<Row>> {
  const chunks = chunkTeamIds(teamIds);
  // No teams is a real, complete answer: this viewer follows nobody.
  if (chunks.length === 0) return { failed: false, rows: [] };

  const results = await Promise.all(
    chunks.flatMap((ids) => [query("home_team_id", ids), query("away_team_id", ids)]),
  );

  let failed = false;
  const byId = new Map<string, Row>();
  for (const result of results) {
    if (result.error) {
      failed = true;
      continue;
    }
    for (const row of result.data ?? []) {
      // A fixture between two followed teams comes back from both sides.
      if (!byId.has(row.id)) byId.set(row.id, row);
    }
  }

  const direction = order === "desc" ? -1 : 1;
  const rows = [...byId.values()]
    .sort((a, b) => direction * a.kickoff_at.localeCompare(b.kickoff_at))
    .slice(0, limit);
  return { failed, rows };
}
