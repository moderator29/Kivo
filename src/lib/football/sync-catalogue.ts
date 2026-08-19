import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { getFootballDataProvider } from "./index";
import { DEFAULT_API_FOOTBALL_COMPETITIONS, getCompetitionScope } from "./competitions-config";
import { currentProviderSeason } from "./sync-coverage";
import { findMappedId } from "./provider-mappings";
import { readLastSpendAt, reserveProviderRequests, type BudgetDecision } from "./request-budget";
import { shouldAttemptCapability } from "./coverage-registry";
import { syncTeamSquad } from "./sync-squads";
import type { SyncResult } from "./sync";
import { logError } from "@/lib/log";

type ServiceClient = SupabaseClient<Database>;

/**
 * The club catalogue: how clubs, squads and managers get into KIVO without
 * waiting for a fixture.
 *
 * ## The defect
 *
 * `syncTodayFixtures` was the only thing in this codebase that ever created a
 * competition or a club, and it builds both out of ONE DAY'S FIXTURES. Run on a
 * Tuesday in August against a live account, it produced 85 competitions —
 * "U19 Bundesliga", "Reserve League", "III Liga - Group 2", "Svenska Cupen" —
 * 705 clubs, no players, no managers and no standings. Real Madrid was missing
 * for the only reason that mattered: Real Madrid did not play that day.
 *
 * ## The shape of the fix, which the quota dictates
 *
 * The provider prices these two things completely differently, and pretending
 * otherwise is how a free tier gets emptied:
 *
 *   clubs   `/teams?league=X&season=Y` — ONE request returns the whole league,
 *           with crests. Same price as one day of fixtures. Cheap.
 *   squads  `/players/squads?team=T`   — ONE request PER CLUB. A twenty-club
 *           league is twenty requests out of about a hundred a day. Expensive.
 *
 * So clubs are pulled a competition at a time and squads are pulled a few clubs
 * at a time, forever resuming, with the resume point written to
 * `provider_backfill_state` (migration 0107) BEFORE the next batch is
 * considered. A backfill that cannot resume is a backfill that re-syncs the
 * same six clubs every day while the rest of the league stays empty.
 *
 * ## Every spend goes through the ledger, and the ledger is the permission
 *
 * `reserveProviderRequests` is called with the exact count a run is about to
 * spend, before it spends any of it, and a refusal stops the run — it is not a
 * warning. The bucket is `catalogue` (limit in `provider_request_limit()`,
 * migration 0107), which is separate from `daily` by construction, so no amount
 * of catalogue backfilling can starve tomorrow's fixture sync.
 */

/** The `provider_backfill_state.scope` values this module writes. Mirrors the
 * table's own CHECK constraint; a value not in that constraint fails the write
 * rather than being silently stored. */
export type BackfillScope = "competition_teams" | "team_squad";

/**
 * The most requests one press of the squad backfill may spend.
 *
 * Separate from, and smaller than, the daily `catalogue` allowance of 12, and
 * the reason is the provider's OTHER limit. API-Football's free tier caps ten
 * requests per MINUTE as well as roughly a hundred per day, and the request
 * ledger cannot see the minute: twelve spends spread across a day and twelve
 * fired in ninety seconds look identical to it, and only one of them comes back
 * 429. Six per press, with a cooldown between presses (below), keeps every
 * rolling minute comfortably under ten without this module having to sleep
 * inside a server action.
 */
export const SQUAD_BATCH_MAX_REQUESTS = 6;

/**
 * How long after a catalogue spend the next batch may start.
 *
 * Paired with SQUAD_BATCH_MAX_REQUESTS above to keep any rolling sixty-second
 * window under the provider's ten-per-minute cap. Refusing costs nothing;
 * bursting costs requests AND returns errors, which is the worst of both.
 */
export const CATALOGUE_BATCH_COOLDOWN_SECONDS = 60;

// ---------------------------------------------------------------------------
// Backfill state
// ---------------------------------------------------------------------------

/**
 * Records an attempt, whether or not it worked.
 *
 * `last_attempted_at` advances on failure too, and that is the point rather
 * than an oversight: the queue is ordered by it, so a club whose squad request
 * fails goes to the back rather than being retried with the very next request.
 * Without that, one club the provider will not serve consumes the entire
 * allowance, one request at a time, every day, while the rest of the league
 * waits behind it.
 */
async function recordBackfillAttempt(
  supabase: ServiceClient,
  provider: string,
  scope: BackfillScope,
  entityId: string,
  outcome: { ok: true; records: number } | { ok: false; error: string },
): Promise<void> {
  const now = new Date().toISOString();
  const payload: Database["public"]["Tables"]["provider_backfill_state"]["Insert"] = {
    provider,
    scope,
    entity_id: entityId,
    last_attempted_at: now,
    last_succeeded_at: outcome.ok ? now : undefined,
    records_processed: outcome.ok ? outcome.records : undefined,
    // Cleared on success so a stale sentence from a previous failure never sits
    // beside a row that has since worked.
    last_error: outcome.ok ? null : outcome.error.slice(0, 2000),
    updated_at: now,
  };

  // On conflict, `last_succeeded_at` and `records_processed` are omitted from
  // the payload on a failure rather than set to null — a failed attempt must
  // not erase the record of a previous success.
  const { error } = await supabase
    .from("provider_backfill_state")
    .upsert(payload, { onConflict: "provider,scope,entity_id" });

  if (error) {
    // Logged, never thrown. Losing the resume point costs a repeated request
    // tomorrow; failing the whole run costs the requests already spent.
    logError("football.sync-catalogue.recordAttempt", error, { detail: `${scope} ${entityId}` });
  }
}

// ---------------------------------------------------------------------------
// Competitions: adopting the allowlist from the coverage registry (0 requests)
// ---------------------------------------------------------------------------

export type AdoptedCompetition = {
  providerId: string;
  /** Null when the coverage registry has no row for this provider id — which
   * means the registry has not been synced, or the provider does not publish
   * this league on the current plan. Never filled in from KIVO's own guess at
   * what the id means. */
  name: string | null;
  country: string | null;
  competitionId: string | null;
  /** What KIVO expected this id to be, from the shipped default list. Null for
   * an id that came from `FOOTBALL_SYNC_COMPETITION_IDS` — KIVO has no
   * expectation about an operator's own id and must not invent one. */
  expectedName: string | null;
  status: "adopted" | "already-known" | "not-in-registry";
};

/**
 * Creates (or names and locates) a `competitions` row for every id in the
 * effective allowlist, using the coverage registry as the source of the name
 * and country.
 *
 * ## Zero provider requests
 *
 * Everything this needs was already bought by one `/leagues` call — the
 * coverage sync. That request returns the id, name, country and type of every
 * competition the plan can see, INCLUDING ones KIVO has never synced a fixture
 * for, which is exactly the set that matters here: the whole problem is that
 * La Liga is not in the database because nobody in La Liga played today.
 *
 * ## Why this is also the allowlist's verification
 *
 * A hardcoded league id is a claim, and a wrong one does not fail loudly — it
 * quietly syncs a different league. Resolving each id against the provider's
 * own registry and reporting the name the PROVIDER gives it, beside the name
 * KIVO expected, is what turns that claim into something an operator can check
 * in five seconds. An id the registry does not know comes back
 * `not-in-registry` and creates nothing: KIVO will not invent a competition row
 * for an id it cannot name.
 */
export async function adoptAllowlistedCompetitions(): Promise<{
  error: string | null;
  competitions: AdoptedCompetition[];
}> {
  const supabase = createServiceRoleSupabaseClient();

  let providerName: string;
  try {
    providerName = (await getFootballDataProvider()).name;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), competitions: [] };
  }

  const scope = getCompetitionScope(providerName);
  if (!scope.providerIds || scope.orderedIds.length === 0) {
    return {
      error:
        "No competition allowlist is in effect, so there is nothing to adopt. Set FOOTBALL_SYNC_COMPETITION_IDS, or unset it to use the shipped default.",
      competitions: [],
    };
  }

  const { data: coverageRows, error: coverageError } = await supabase
    .from("provider_coverage")
    .select("provider_competition_id, competition_name, country, season_year")
    .eq("provider", providerName)
    .in("provider_competition_id", scope.orderedIds)
    .order("season_year", { ascending: false });

  if (coverageError) {
    logError("football.sync-catalogue.adoptReadCoverage", coverageError);
    return { error: "Couldn't read the coverage registry. Try again.", competitions: [] };
  }

  // Newest season first from the query, so the first row seen for an id is the
  // newest one KIVO holds.
  const registry = new Map<string, { name: string | null; country: string | null }>();
  for (const row of coverageRows ?? []) {
    if (registry.has(row.provider_competition_id)) continue;
    registry.set(row.provider_competition_id, { name: row.competition_name, country: row.country });
  }

  const expectedByProviderId = new Map(
    getKnownCompetitionsFor(providerName).map((c) => [c.providerId, c.expectedName] as const),
  );

  const results: AdoptedCompetition[] = [];
  for (const providerId of scope.orderedIds) {
    const known = registry.get(providerId) ?? null;
    const expectedName = expectedByProviderId.get(providerId) ?? null;
    const existingId = await findMappedId(supabase, providerName, "competition", providerId);

    if (!known || !known.name) {
      results.push({
        providerId,
        name: null,
        country: null,
        competitionId: existingId,
        expectedName,
        status: "not-in-registry",
      });
      continue;
    }

    if (existingId) {
      // Already in KIVO. Refresh the name and country from the registry — the
      // provider is the authority on both, and a competition first created by a
      // fixture sync has a null country by definition.
      const update: Database["public"]["Tables"]["competitions"]["Update"] = { name: known.name };
      if (known.country !== null) update.country = known.country;
      const { error } = await supabase.from("competitions").update(update).eq("id", existingId);
      if (error) logError("football.sync-catalogue.adoptUpdate", error, { detail: providerId });
      results.push({
        providerId,
        name: known.name,
        country: known.country,
        competitionId: existingId,
        expectedName,
        status: "already-known",
      });
      continue;
    }

    const { data: newId, error: rpcError } = await supabase.rpc("upsert_competition_with_mapping", {
      p_provider: providerName,
      p_provider_entity_id: providerId,
      p_name: known.name,
    });
    if (rpcError || !newId) {
      logError("football.sync-catalogue.adoptInsert", rpcError, { detail: providerId });
      results.push({
        providerId,
        name: known.name,
        country: known.country,
        competitionId: null,
        expectedName,
        status: "not-in-registry",
      });
      continue;
    }
    if (known.country !== null) {
      const { error } = await supabase.from("competitions").update({ country: known.country }).eq("id", newId);
      if (error) logError("football.sync-catalogue.adoptCountry", error, { detail: providerId });
    }
    results.push({
      providerId,
      name: known.name,
      country: known.country,
      competitionId: newId,
      expectedName,
      status: "adopted",
    });
  }

  return { error: null, competitions: results };
}

/** The shipped expectations for one provider, or none for a provider KIVO has
 * no vetted list for. `DEFAULT_API_FOOTBALL_COMPETITIONS` is API-Football's
 * numbering and means nothing under another provider's ids. */
function getKnownCompetitionsFor(providerName: string) {
  return providerName === "api-football" ? DEFAULT_API_FOOTBALL_COMPETITIONS : [];
}

// ---------------------------------------------------------------------------
// Competition country backfill (0 requests)
// ---------------------------------------------------------------------------

/**
 * Fills `competitions.country` for every competition KIVO already holds, from
 * the coverage registry.
 *
 * Zero provider requests, and it is the repair for the live database's most
 * visible symptom: every one of its 85 competitions has a null country, and the
 * leagues UI renders null as "International" — so a Polish third-division group
 * is presented to the founder as an international competition.
 *
 * Only ever writes a country onto a competition that has none. An admin (or a
 * future richer source) who has corrected one by hand must not have it
 * overwritten by a registry refresh.
 */
export async function backfillCompetitionCountries(): Promise<{ error: string | null; recordsProcessed: number }> {
  const supabase = createServiceRoleSupabaseClient();

  let providerName: string;
  try {
    providerName = (await getFootballDataProvider()).name;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), recordsProcessed: 0 };
  }

  const { data: rows, error } = await supabase
    .from("provider_coverage")
    .select("competition_id, country")
    .eq("provider", providerName)
    .not("competition_id", "is", null)
    .not("country", "is", null);

  if (error) {
    logError("football.sync-catalogue.countryBackfillRead", error);
    return { error: "Couldn't read the coverage registry. Try again.", recordsProcessed: 0 };
  }
  if (!rows || rows.length === 0) {
    return { error: null, recordsProcessed: 0 };
  }

  // One competition can have several coverage rows (one per season). They carry
  // the same country, so the first is enough.
  const countryByCompetition = new Map<string, string>();
  for (const row of rows) {
    if (!row.competition_id || !row.country) continue;
    if (!countryByCompetition.has(row.competition_id)) countryByCompetition.set(row.competition_id, row.country);
  }

  let updated = 0;
  for (const [competitionId, country] of countryByCompetition) {
    const { data, error: updateError } = await supabase
      .from("competitions")
      .update({ country })
      .eq("id", competitionId)
      .is("country", null)
      .select("id");
    if (updateError) {
      logError("football.sync-catalogue.countryBackfillWrite", updateError, { detail: competitionId });
      continue;
    }
    updated += data?.length ?? 0;
  }

  return { error: null, recordsProcessed: updated };
}

// ---------------------------------------------------------------------------
// Clubs: one competition's whole club list, for one request
// ---------------------------------------------------------------------------

/** A season row for a competition, created if the competition has none for this
 * provider year. Mirrors `upsertSeason` in sync.ts — same "YYYY/YYYY+1" name and
 * same `provider_year` — but deliberately does NOT touch `is_current`.
 *
 * That omission is the point. `sync.ts` marks a season current because a
 * fixture the provider reported TODAY is evidence about which season is
 * running. A club list for a season an operator typed into a button is not that
 * evidence, and flipping `is_current` off the season that actually has fixtures
 * would empty "/fantasy" and every team's league position. */
async function ensureSeason(
  supabase: ServiceClient,
  competitionId: string,
  seasonYear: number,
): Promise<string | null> {
  const name = `${seasonYear}/${seasonYear + 1}`;

  const { data: existing, error: selectError } = await supabase
    .from("seasons")
    .select("id")
    .eq("competition_id", competitionId)
    .eq("name", name)
    .maybeSingle();
  if (selectError) {
    logError("football.sync-catalogue.ensureSeasonRead", selectError, { detail: competitionId });
    return null;
  }
  if (existing) return existing.id;

  const { data: created, error: insertError } = await supabase
    .from("seasons")
    .insert({ competition_id: competitionId, name, provider_year: seasonYear })
    .select("id")
    .single();

  if (insertError) {
    // Another writer got there first — re-read rather than fail.
    if (insertError.code === "23505") {
      const { data: retried } = await supabase
        .from("seasons")
        .select("id")
        .eq("competition_id", competitionId)
        .eq("name", name)
        .maybeSingle();
      return retried?.id ?? null;
    }
    logError("football.sync-catalogue.ensureSeasonInsert", insertError, { detail: competitionId });
    return null;
  }
  return created?.id ?? null;
}

export type CompetitionTeamsSyncResult = SyncResult & {
  /** How many provider requests this call actually spent. Zero on a refusal or
   * a skip — reported so the admin surface can state the real cost rather than
   * the intended one. */
  requestsSpent: number;
  budget: BudgetDecision | null;
};

/**
 * Every club in one competition and season, for ONE provider request.
 *
 * This is the method that makes the club directory independent of the fixture
 * list. It writes:
 *
 *   - a `teams` row per club, via the same `upsert_team_with_mapping` RPC the
 *     fixture sync uses, so a club already known from a fixture is UPDATED
 *     rather than duplicated under a second row;
 *   - `teams.country` and `teams.founded_year`, which the fixture path can
 *     never fill because `/fixtures` does not report them;
 *   - a `competition_teams` row per club, which is the league membership KIVO
 *     previously had no way to express.
 *
 * Crests: written through the RPC's `coalesce`, so a club that already has one
 * keeps it if the provider sends null this time.
 */
export async function syncCompetitionTeams(
  competitionId: string,
  season?: number,
): Promise<CompetitionTeamsSyncResult> {
  const supabase = createServiceRoleSupabaseClient();
  const provider = await getFootballDataProvider();
  const seasonYear = season ?? currentProviderSeason();

  const fail = (message: string, spent = 0, budget: BudgetDecision | null = null): CompetitionTeamsSyncResult => ({
    status: "failed",
    recordsProcessed: 0,
    error: message,
    requestsSpent: spent,
    budget,
  });

  const competitionProviderId = await findMappedId(supabase, provider.name, "competition", competitionId);
  if (!competitionProviderId) {
    return fail(
      `This competition has no ${provider.name} mapping, so KIVO has no league id to ask for. Adopt the allowlisted competitions first.`,
    );
  }

  const { data: syncRun, error: startError } = await supabase
    .from("sync_runs")
    .insert({ provider: provider.name, entity_type: "team", status: "running", trigger_source: "manual" })
    .select("id")
    .single();
  if (startError || !syncRun) {
    logError("football.sync-catalogue.startTeamsRun", startError);
    return fail(startError?.message ?? "Could not create sync_runs row");
  }

  const finish = async (
    status: Database["public"]["Enums"]["sync_status"],
    processed: number,
    errorMessage: string | null,
    spent: number,
    budget: BudgetDecision | null,
  ): Promise<CompetitionTeamsSyncResult> => {
    const finishedAt = new Date().toISOString();
    await supabase
      .from("sync_runs")
      .update({
        status,
        finished_at: finishedAt,
        last_synced_at: status === "failed" || status === "skipped" ? null : finishedAt,
        records_processed: processed,
        error_message: errorMessage,
        provider_quota_remaining: provider.getQuotaRemaining(),
      })
      .eq("id", syncRun.id);
    return {
      status: status === "failed" ? "failed" : "succeeded",
      recordsProcessed: processed,
      error: errorMessage ?? undefined,
      requestsSpent: spent,
      budget,
    };
  };

  // The ledger is the permission, not a warning. Reserved before the request,
  // for exactly the count about to be spent.
  const budget = await reserveProviderRequests(supabase, provider.name, "catalogue", 1);
  if (!budget.allowed) {
    return finish(
      "skipped",
      0,
      `Catalogue allowance is spent: ${budget.spentInWindow}/${budget.limit} requests in the last 24 hours. It frees up as the oldest spend falls out of the window.`,
      0,
      budget,
    );
  }

  let clubs;
  try {
    clubs = await provider.getTeamsByLeague(competitionProviderId, seasonYear);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("football.sync-catalogue.getTeamsByLeague", err, { detail: competitionProviderId });
    await recordBackfillAttempt(supabase, provider.name, "competition_teams", competitionId, {
      ok: false,
      error: message,
    });
    return finish("failed", 0, message, 1, budget);
  }

  if (clubs.length === 0) {
    // A real answer, not a failure: the provider has not published this league
    // for this season. Recorded as an attempt so the queue moves on, and as
    // `skipped` so Data Health does not claim a club list was filled.
    await recordBackfillAttempt(supabase, provider.name, "competition_teams", competitionId, { ok: true, records: 0 });
    return finish(
      "skipped",
      0,
      `${provider.name} published no clubs for league ${competitionProviderId} in season ${seasonYear}.`,
      1,
      budget,
    );
  }

  const seasonId = await ensureSeason(supabase, competitionId, seasonYear);
  if (seasonId === null) {
    await recordBackfillAttempt(supabase, provider.name, "competition_teams", competitionId, {
      ok: false,
      error: "Could not resolve a season row",
    });
    return finish("failed", 0, "Could not resolve a season row for this competition.", 1, budget);
  }

  let processed = 0;
  const errors: string[] = [];
  const now = new Date().toISOString();

  for (const club of clubs) {
    try {
      const rpcArgs: Database["public"]["Functions"]["upsert_team_with_mapping"]["Args"] = {
        p_provider: provider.name,
        p_provider_entity_id: club.providerId,
        p_name: club.name,
      };
      if (club.shortName !== null) rpcArgs.p_short_name = club.shortName;
      if (club.crestUrl !== null) rpcArgs.p_crest_url = club.crestUrl;

      const { data: teamId, error: rpcError } = await supabase.rpc("upsert_team_with_mapping", rpcArgs);
      if (rpcError || !teamId) throw rpcError ?? new Error("upsert_team_with_mapping returned no id");

      // country/founded_year are not parameters of the shared RPC (the fixture
      // sync has neither value to give it), so they are a second write —
      // never-clobber-with-null, the same rule sync-squads.ts applies to
      // players.
      const teamUpdate: Database["public"]["Tables"]["teams"]["Update"] = {};
      if (club.country !== null) teamUpdate.country = club.country;
      if (club.founded !== null) teamUpdate.founded_year = club.founded;
      if (Object.keys(teamUpdate).length > 0) {
        const { error: updateError } = await supabase.from("teams").update(teamUpdate).eq("id", teamId);
        if (updateError) throw updateError;
      }

      const { error: linkError } = await supabase.from("competition_teams").upsert(
        {
          competition_id: competitionId,
          season_id: seasonId,
          team_id: teamId,
          provider: provider.name,
          last_seen_at: now,
          updated_at: now,
        },
        { onConflict: "provider,season_id,team_id" },
      );
      if (linkError) throw linkError;

      processed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError("football.sync-catalogue.upsertClub", err, { detail: `club ${club.providerId} (${club.name})` });
      errors.push(`${club.name}: ${message}`);
    }
  }

  await recordBackfillAttempt(
    supabase,
    provider.name,
    "competition_teams",
    competitionId,
    errors.length === 0 ? { ok: true, records: processed } : { ok: false, error: errors.slice(0, 5).join("; ") },
  );

  const status: Database["public"]["Enums"]["sync_status"] =
    errors.length === 0 ? "success" : processed === 0 ? "failed" : "partial";
  return finish(status, processed, errors.length > 0 ? errors.slice(0, 20).join("; ") : null, 1, budget);
}

// ---------------------------------------------------------------------------
// Squads: the expensive half, one club at a time, resumable
// ---------------------------------------------------------------------------

export type SquadBackfillCandidate = {
  teamId: string;
  teamName: string;
  competitionId: string;
  competitionName: string;
  lastAttemptedAt: string | null;
  playersOnFile: number;
};

/**
 * Which clubs the squad backfill would do next, in order, without spending
 * anything.
 *
 * Restricted to clubs that are in `competition_teams` — that is, clubs KIVO
 * pulled deliberately as part of an allowlisted competition. The 705 clubs the
 * fixture sync scraped off one Tuesday are NOT candidates: spending a request
 * per club on a Polish reserve side is exactly the failure this whole module
 * exists to stop, and a club that matters will arrive here the moment its
 * competition's club list is synced.
 *
 * Ordered longest-waiting first, nulls first, so a club never attempted at all
 * is always served before one that has been.
 */
export async function listSquadBackfillCandidates(limit = 50): Promise<{
  error: string | null;
  candidates: SquadBackfillCandidate[];
  /** Clubs in an allowlisted competition that have no players on file at all.
   * The number the admin surface should present as "outstanding". */
  outstanding: number;
}> {
  const supabase = createServiceRoleSupabaseClient();

  let providerName: string;
  try {
    providerName = (await getFootballDataProvider()).name;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), candidates: [], outstanding: 0 };
  }

  const { data: memberships, error } = await supabase
    .from("competition_teams")
    .select("team_id, competition_id, teams(id, name), competitions(id, name)")
    .eq("provider", providerName);

  if (error) {
    logError("football.sync-catalogue.listCandidates", error);
    return { error: "Couldn't read the club directory. Try again.", candidates: [], outstanding: 0 };
  }
  if (!memberships || memberships.length === 0) {
    return { error: null, candidates: [], outstanding: 0 };
  }

  const teamIds = Array.from(new Set(memberships.map((m) => m.team_id)));

  const [{ data: playerRows }, { data: stateRows }] = await Promise.all([
    supabase.from("players").select("current_team_id").in("current_team_id", teamIds),
    supabase
      .from("provider_backfill_state")
      .select("entity_id, last_attempted_at")
      .eq("provider", providerName)
      .eq("scope", "team_squad")
      .in("entity_id", teamIds),
  ]);

  const playerCounts = new Map<string, number>();
  for (const row of playerRows ?? []) {
    if (!row.current_team_id) continue;
    playerCounts.set(row.current_team_id, (playerCounts.get(row.current_team_id) ?? 0) + 1);
  }
  const attemptedAt = new Map<string, string | null>();
  for (const row of stateRows ?? []) attemptedAt.set(row.entity_id, row.last_attempted_at);

  const seen = new Set<string>();
  const all: SquadBackfillCandidate[] = [];
  for (const membership of memberships) {
    if (seen.has(membership.team_id)) continue;
    seen.add(membership.team_id);
    all.push({
      teamId: membership.team_id,
      teamName: membership.teams?.name ?? "Unnamed club",
      competitionId: membership.competition_id,
      competitionName: membership.competitions?.name ?? "Unnamed competition",
      lastAttemptedAt: attemptedAt.get(membership.team_id) ?? null,
      playersOnFile: playerCounts.get(membership.team_id) ?? 0,
    });
  }

  // Longest-waiting first: never attempted (null) before ever attempted, then
  // oldest attempt first.
  all.sort((a, b) => {
    if (a.lastAttemptedAt === b.lastAttemptedAt) return a.teamName.localeCompare(b.teamName);
    if (a.lastAttemptedAt === null) return -1;
    if (b.lastAttemptedAt === null) return 1;
    return a.lastAttemptedAt.localeCompare(b.lastAttemptedAt);
  });

  return {
    error: null,
    candidates: all.slice(0, limit),
    outstanding: all.filter((c) => c.playersOnFile === 0).length,
  };
}

export type SquadBackfillResult = {
  error: string | null;
  /** Clubs whose squad was actually fetched and written. */
  clubsSynced: number;
  playersProcessed: number;
  requestsSpent: number;
  /** Clubs attempted that came back with an error, named so an operator can see
   * which ones and why rather than only that some failed. */
  failures: Array<{ teamName: string; message: string }>;
  budget: BudgetDecision | null;
  /** True when there is more work left after this batch — the honest way to say
   * "press again tomorrow" rather than implying the job is done. */
  moreRemaining: boolean;
};

/**
 * One bounded, resumable batch of squad syncs.
 *
 * ## What one press costs
 *
 * At most `SQUAD_BATCH_MAX_REQUESTS` (6) provider requests, and the exact count
 * is reserved from the `catalogue` bucket BEFORE the first request is made. A
 * partial reservation is not attempted: if only four of six are available, four
 * are reserved and four clubs are done. If none are available the run does
 * nothing and says so.
 *
 * `syncTeamSquad` makes TWO provider calls per club — the squad and the manager
 * — which is why the reservation is `2 × clubs`, not `clubs`. Getting that
 * wrong would mean the ledger under-counting by half, which is the same as not
 * having a ledger.
 *
 * ## Resumability is not a nice-to-have here
 *
 * Six clubs a press against a twenty-club league means the league takes several
 * presses across several days. Every attempt is written to
 * `provider_backfill_state` as it happens, so the next press starts where this
 * one stopped — including after a crash mid-batch, because the state is written
 * per club rather than at the end.
 */
export async function backfillSquads(maxClubs?: number): Promise<SquadBackfillResult> {
  const supabase = createServiceRoleSupabaseClient();

  let providerName: string;
  try {
    providerName = (await getFootballDataProvider()).name;
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      clubsSynced: 0,
      playersProcessed: 0,
      requestsSpent: 0,
      failures: [],
      budget: null,
      moreRemaining: false,
    };
  }

  const empty = (error: string | null, budget: BudgetDecision | null = null): SquadBackfillResult => ({
    error,
    clubsSynced: 0,
    playersProcessed: 0,
    requestsSpent: 0,
    failures: [],
    budget,
    moreRemaining: false,
  });

  // The provider's per-minute cap is invisible to the daily ledger — see
  // CATALOGUE_BATCH_COOLDOWN_SECONDS.
  const lastSpendAt = await readLastSpendAt(supabase, providerName, "catalogue");
  if (lastSpendAt) {
    const elapsedSeconds = (Date.now() - new Date(lastSpendAt).getTime()) / 1000;
    if (elapsedSeconds < CATALOGUE_BATCH_COOLDOWN_SECONDS) {
      const wait = Math.ceil(CATALOGUE_BATCH_COOLDOWN_SECONDS - elapsedSeconds);
      return empty(
        `The last catalogue request was ${Math.floor(elapsedSeconds)}s ago. Wait ${wait}s — API-Football's free tier also caps requests per minute, and bursting past it costs requests and returns errors.`,
      );
    }
  }

  const { error: listError, candidates } = await listSquadBackfillCandidates(200);
  if (listError) return empty(listError);
  if (candidates.length === 0) {
    return empty(
      "No clubs are queued. Sync an allowlisted competition's club list first — the squad backfill only ever touches clubs KIVO pulled deliberately as part of a competition, never the ones a fixture happened to mention.",
    );
  }

  const requestedClubs = Math.max(1, Math.min(maxClubs ?? SQUAD_BATCH_MAX_REQUESTS, SQUAD_BATCH_MAX_REQUESTS));

  // Two provider calls per club: squad + manager.
  const REQUESTS_PER_CLUB = 2;

  // Reserve for as many clubs as the allowance actually permits, largest first,
  // rather than reserving optimistically and spending what is not there.
  let reserved: BudgetDecision | null = null;
  let clubsThisRun = 0;
  for (let clubs = Math.min(requestedClubs, candidates.length); clubs >= 1; clubs -= 1) {
    const decision = await reserveProviderRequests(
      supabase,
      providerName,
      "catalogue",
      clubs * REQUESTS_PER_CLUB,
    );
    if (decision.allowed) {
      reserved = decision;
      clubsThisRun = clubs;
      break;
    }
    reserved = decision;
  }

  if (clubsThisRun === 0) {
    return empty(
      `Catalogue allowance is spent: ${reserved?.spentInWindow ?? "?"}/${reserved?.limit ?? "?"} requests in the last 24 hours. Each club costs ${REQUESTS_PER_CLUB} (squad + manager), so this needs at least ${REQUESTS_PER_CLUB} free. It frees up as the oldest spend falls out of the rolling window.`,
      reserved,
    );
  }

  const batch = candidates.slice(0, clubsThisRun);
  const failures: SquadBackfillResult["failures"] = [];
  let clubsSynced = 0;
  let playersProcessed = 0;
  /** Clubs this run actually sent to the provider. A club skipped on a
   * definite `unsupported` coverage verdict never reached the network, so it is
   * not counted here — the reported spend and the ledger's spend must describe
   * the same act, and a figure that quietly included skips would be a different
   * scope wearing the same label. (Its reservation is still consumed; the
   * ledger is deliberately conservative in the direction of spending less.) */
  let clubsAttempted = 0;

  for (const candidate of batch) {
    // The coverage registry is consulted before every spend, per the project's
    // standing rule. `unknown` attempts; only a definite `unsupported` skips —
    // a registry that has never been synced must not silently switch the
    // backfill off.
    const { attempt, verdict } = await shouldAttemptCapability(
      supabase,
      providerName,
      candidate.competitionId,
      "players",
    );
    if (!attempt) {
      await recordBackfillAttempt(supabase, providerName, "team_squad", candidate.teamId, {
        ok: false,
        error: `${providerName} declares it publishes no player data for ${candidate.competitionName} (coverage: ${verdict}).`,
      });
      failures.push({
        teamName: candidate.teamName,
        message: `${candidate.competitionName} publishes no player data on this plan — skipped without spending a request.`,
      });
      continue;
    }

    clubsAttempted += 1;
    const result = await syncTeamSquad(candidate.teamId);
    if (result.status === "failed") {
      await recordBackfillAttempt(supabase, providerName, "team_squad", candidate.teamId, {
        ok: false,
        error: result.error ?? "Squad sync failed",
      });
      failures.push({ teamName: candidate.teamName, message: result.error ?? "Squad sync failed" });
      continue;
    }

    await recordBackfillAttempt(supabase, providerName, "team_squad", candidate.teamId, {
      ok: true,
      records: result.recordsProcessed,
    });
    clubsSynced += 1;
    playersProcessed += result.recordsProcessed;
  }

  const requestsSpent = clubsAttempted * REQUESTS_PER_CLUB;

  return {
    error: null,
    clubsSynced,
    playersProcessed,
    requestsSpent,
    failures,
    budget: reserved,
    moreRemaining: candidates.length > batch.length,
  };
}
