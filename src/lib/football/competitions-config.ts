import "server-only";

/**
 * RECOMMENDATIONS.md item 28: scope `syncTodayFixtures` to specific
 * competitions instead of pulling every league the active provider's
 * `/fixtures?date=` (or TheSportsDB's `/eventsday.php`) endpoint returns for
 * the day. Config-driven via `FOOTBALL_SYNC_COMPETITION_IDS`, following the
 * exact same "env var, not a hardcoded value" pattern as
 * `FOOTBALL_DATA_PROVIDER` in `./index.ts` — never a single hardcoded league
 * id, and never a KIVO-invented "these are the leagues we cover" list, since
 * this codebase has no such product decision recorded anywhere to encode.
 *
 * The filter is applied to the already-fetched response, not via a
 * per-league request: item 28's own text is explicit that "the free tier's
 * real constraint is request count, not response size", so filtering
 * post-fetch costs zero extra provider requests versus calling
 * `getFixturesByDate` once per configured league — it just narrows what
 * `syncTodayFixtures` writes to `competitions`/`teams`/`venues`/`fixtures`.
 *
 * IDs are the active provider's OWN competition/league ids
 * (`NormalizedFixture.competitionProviderId` — API-Football's numeric league
 * ids, or TheSportsDB's `idLeague` strings when that provider is selected),
 * not KIVO's internal `competitions.id` uuids, since filtering happens
 * before any KIVO id exists for a not-yet-synced competition.
 *
 * Unset (the default) means "no filter" — every league the provider reports
 * for the day still syncs, exactly like before this item shipped. This is a
 * deliberate choice, not an oversight: no competition allowlist exists
 * anywhere else in this codebase to default to, so defaulting to a filtered
 * set would mean KIVO silently deciding — and fabricating an unstated
 * assumption about — which leagues the product covers. The admin-triggered
 * sync flow (`syncTodayFixtures`) behaves identically until someone sets
 * this var, at which point it becomes a real, working scope.
 */
export function getSyncedCompetitionProviderIds(): Set<string> | null {
  const raw = process.env.FOOTBALL_SYNC_COMPETITION_IDS;
  if (!raw || !raw.trim()) return null;

  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  return ids.length > 0 ? new Set(ids) : null;
}
