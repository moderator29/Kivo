import "server-only";

/**
 * Which competitions KIVO's pipeline is scoped to.
 *
 * ## Why this file now has a default, when it deliberately had none
 *
 * The original note here said, correctly, that KIVO had no recorded product
 * decision about which leagues it covers, and that inventing one in code would
 * be KIVO silently deciding the product's scope. So the default was "no
 * filter": sync every league the provider reports for the day.
 *
 * Reality has since supplied the missing decision. Running unfiltered against
 * API-Football on a Tuesday in August produced 85 competitions and 705 clubs,
 * and the competitions were "U19 Bundesliga", "Reserve League",
 * "III Liga - Group 2", "Friendlies Clubs", "Svenska Cupen". Not one of the
 * clubs anybody would look for was in the database, because the only entry
 * point (`syncTodayFixtures`) creates competitions and teams from *today's
 * fixtures*, and on that day the world's football was youth, reserve and third
 * divisions. An unfiltered pipeline on a hundred-requests-a-day tier does not
 * produce broad coverage; it produces whatever happened to kick off.
 *
 * So there is now a default, and the shape of it matters:
 *
 *  - It is a **default**, not a law. `FOOTBALL_SYNC_COMPETITION_IDS` overrides
 *    it completely, and `FOOTBALL_SYNC_COMPETITION_IDS=all` restores the old
 *    unfiltered behaviour exactly. Nothing here is unreachable from config.
 *  - Every id below is stated with its provenance, and an id KIVO could not
 *    establish with certainty is **absent and named as absent** rather than
 *    guessed. A wrong league id does not fail loudly — it silently syncs the
 *    wrong league, or nothing — so a plausible guess is worse than a gap.
 *  - The admin panel resolves every id in the effective list against the
 *    provider's OWN league registry (`provider_coverage`, filled by one
 *    `/leagues` request) and shows the name and country the provider returns
 *    for it. That is how these ids get verified against the provider rather
 *    than against anyone's memory, and it costs no extra request.
 *
 * ## IDs are the provider's, not KIVO's
 *
 * These are the active provider's own competition/league ids
 * (`NormalizedFixture.competitionProviderId` — API-Football's numeric league
 * ids, or TheSportsDB's `idLeague` strings when that provider is selected), not
 * KIVO's internal `competitions.id` uuids, because filtering happens before any
 * KIVO id exists for a not-yet-synced competition.
 *
 * The values below are **API-Football's**. Selecting TheSportsDB via
 * `FOOTBALL_DATA_PROVIDER` and leaving this unset would apply API-Football's
 * numbering to a different provider's ids, which is why
 * `getSyncedCompetitionProviderIds` takes the provider name and returns no
 * default for anything other than api-football — see below.
 */

/** One entry in the shipped default, carrying why KIVO believes the id. */
export type KnownCompetition = {
  /** API-Football's own numeric league id, as a string. */
  providerId: string;
  /** What the provider is expected to call it. Display only — the admin panel
   * shows the provider's ACTUAL name for the id beside this, and a mismatch
   * between the two is the signal that an id here is wrong. */
  expectedName: string;
  expectedCountry: string;
};

/**
 * The shipped default scope, for `api-football` only.
 *
 * Every id here is one of API-Football v3's long-stable, widely published
 * top-flight league ids — the small set that appears in the provider's own
 * documentation examples and has not been renumbered. They are still treated as
 * claims to be checked, not facts: see the verification note above.
 *
 * ## What is deliberately NOT here
 *
 * **The Nigeria Professional Football League.** KIVO could not establish its
 * API-Football league id with certainty from this environment (there is no
 * route to api-football.com from the build container, and no id for it appears
 * in any source this codebase can check). The founder is Nigerian and launching
 * in Nigeria, so this is the single most wanted entry in this list — which is
 * exactly why it must not be a guess. A wrong id would quietly scope the
 * pipeline to some other country's league and look like it worked.
 *
 * The path to adding it costs zero guesses and one request that KIVO already
 * makes: run the coverage-registry sync (`/leagues`, one request, every league
 * the plan can see), then search the registry on Data Health for Nigeria. The
 * provider's own id and name come back, and setting
 * `FOOTBALL_SYNC_COMPETITION_IDS` to this list plus that id makes it real. The
 * admin panel exists to make that a two-minute job rather than a research
 * project.
 */
export const DEFAULT_API_FOOTBALL_COMPETITIONS: readonly KnownCompetition[] = [
  { providerId: "39", expectedName: "Premier League", expectedCountry: "England" },
  { providerId: "140", expectedName: "La Liga", expectedCountry: "Spain" },
  { providerId: "135", expectedName: "Serie A", expectedCountry: "Italy" },
  { providerId: "78", expectedName: "Bundesliga", expectedCountry: "Germany" },
  { providerId: "61", expectedName: "Ligue 1", expectedCountry: "France" },
  { providerId: "2", expectedName: "UEFA Champions League", expectedCountry: "World" },
  { providerId: "3", expectedName: "UEFA Europa League", expectedCountry: "World" },
];

/** The env var's literal value that means "no filter at all" — the exact
 * behaviour this module had before a default existed. Spelled as a word rather
 * than as "unset" because unset now means "use the default", and an operator
 * who wants the old behaviour needs a way to say so that is not the absence of
 * a setting. */
const UNFILTERED_SENTINEL = "all";

/** Where the effective scope came from, so the admin panel can say so plainly
 * rather than leaving an operator to infer it. */
export type CompetitionScopeSource = "env" | "default" | "unfiltered";

export type CompetitionScope = {
  /** Null means no filter: every competition the provider reports is synced. */
  providerIds: Set<string> | null;
  source: CompetitionScopeSource;
  /** The ids in the order they were configured/shipped — `providerIds` is a Set
   * and has no meaningful order for display. Empty when unfiltered. */
  orderedIds: string[];
};

function parseEnvIds(raw: string): string[] {
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/**
 * The effective competition scope for one provider.
 *
 * Order of precedence:
 *   1. `FOOTBALL_SYNC_COMPETITION_IDS=all`   → no filter.
 *   2. `FOOTBALL_SYNC_COMPETITION_IDS=a,b,c` → exactly those ids.
 *   3. unset, provider is api-football       → DEFAULT_API_FOOTBALL_COMPETITIONS.
 *   4. unset, any other provider             → no filter.
 *
 * Case 4 is not an oversight. The shipped default is a list of API-Football's
 * numbering; applying it to TheSportsDB's `idLeague` values would filter that
 * provider's response against ids that mean something else entirely, and the
 * likeliest outcome is an empty sync that looks like an outage. A provider KIVO
 * has no vetted list for gets no invented one.
 */
export function getCompetitionScope(providerName?: string): CompetitionScope {
  const raw = process.env.FOOTBALL_SYNC_COMPETITION_IDS;

  if (raw && raw.trim()) {
    const trimmed = raw.trim();
    if (trimmed.toLowerCase() === UNFILTERED_SENTINEL) {
      return { providerIds: null, source: "unfiltered", orderedIds: [] };
    }
    const ids = parseEnvIds(trimmed);
    if (ids.length > 0) {
      return { providerIds: new Set(ids), source: "env", orderedIds: ids };
    }
    // A var set to only commas/whitespace is a configuration mistake, not a
    // request for a filter. Falling through to the default is the safer of the
    // two readings: the alternative is an empty allowlist, which would scope
    // every sync down to nothing and present as "there is no football".
  }

  if (providerName === undefined || providerName === "api-football") {
    const ids = DEFAULT_API_FOOTBALL_COMPETITIONS.map((c) => c.providerId);
    return { providerIds: new Set(ids), source: "default", orderedIds: ids };
  }

  return { providerIds: null, source: "unfiltered", orderedIds: [] };
}

/**
 * The scope as the fixture sync consumes it: a Set to test membership against,
 * or null for "no filter".
 *
 * Kept as a separate named export because that is the only thing `sync.ts`
 * needs and it is the signature every existing caller already uses — the extra
 * provenance in `CompetitionScope` is for the admin surface.
 */
export function getSyncedCompetitionProviderIds(providerName?: string): Set<string> | null {
  return getCompetitionScope(providerName).providerIds;
}
