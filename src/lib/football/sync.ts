import { logError } from "@/lib/log";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";
import { getFootballDataProvider } from "./index";
import type { FixtureStatus, NormalizedFixture, NormalizedTeam } from "./types";
import { notifyFixtureStatusChange, type FixtureStatusChangeInput } from "./match-notifications";
import { createAsyncMemo, createKeyedSerializer, mapWithConcurrency } from "@/lib/concurrency";
import { resolveSyncedCompetitionProviderIds } from "./competition-scope";
// KIVO_NEXT_GEN KN-12: batchFindMappedIds used to live privately in this file.
// sync-match-details.ts is now a second caller, so it moved to the shared
// provider-mappings module (and gained chunking on the way).
import { batchFindMappedIds } from "./provider-mappings";
import {
  claimSyncLock,
  flagAbsentFixtures,
  reapAbandonedSyncRuns,
  markFixturesSeen,
  recordAnomaly,
  recordEntityFailures,
  releaseSyncLock,
  renewSyncLockIfNeeded,
  resolveEntityFailures,
  type EntityFailure,
} from "./sync-instrumentation";

type ServiceClient = SupabaseClient<Database>;
type DbFixtureStatus = Database["public"]["Enums"]["fixture_status"];

/**
 * Who started a sync run. Persisted verbatim onto `sync_runs.trigger_source`
 * (migrations 0044 and 0070), and the four values have genuinely different
 * quota profiles, which is why they are distinguished rather than collapsed:
 *
 *   manual — an admin clicked a sync button. Supervised, unbounded frequency.
 *   cron   — the once-a-minute live worker. Unsupervised, six gates in front of it.
 *   auto   — a page load found the data stale and scheduled a sync after the
 *            response was sent. Unsupervised, frequency bounded by traffic.
 *   daily  — the once-a-day baseline. Unsupervised, exactly one call a day.
 */
export type SyncTriggerSource = "manual" | "cron" | "auto" | "daily";

export interface SyncResult {
  status: "succeeded" | "failed";
  recordsProcessed: number;
  error?: string;
}

/** FixtureStatus and the DB's fixture_status enum are 1:1 (see types.ts and
 * migration 0017) — no translation needed, but keep the named function so a
 * future divergence between the two types is a type error here, not a typo. */
function toDbFixtureStatus(status: FixtureStatus): DbFixtureStatus {
  return status;
}

/** Updates the row on every sync (a renamed competition or a new short name
 * should actually land), same "sync is the source of truth for what the
 * provider reports" rule as upsertFixture below. `knownMappings` is the batched
 * lookup from batchFindMappedIds — see its doc comment for why this takes a map
 * instead of querying provider_mappings itself.
 *
 * The already-known branch stays a plain client-side update (no atomicity
 * concern — there's no second write to lose). The new-entity branch goes
 * through upsert_competition_with_mapping (migration 0018) instead of a
 * separate insert-then-createMapping pair, so a mapping insert failure can no
 * longer leave an orphan competition row behind (RECOMMENDATIONS.md item 22). */
async function upsertCompetition(
  supabase: ServiceClient,
  provider: string,
  competitionProviderId: string,
  name: string,
  country: string | null,
  knownMappings: Map<string, string>,
): Promise<string> {
  const existing = knownMappings.get(competitionProviderId) ?? null;
  if (existing) {
    const update: Database["public"]["Tables"]["competitions"]["Update"] = { name };
    // Never clobber a country already on file with a null. The provider omits
    // the field on some responses, and a competition whose country KIVO learned
    // from `/leagues` (or that an admin corrected by hand) must not lose it
    // because one fixture payload left it out — same rule sync-squads.ts
    // applies to every optional player field.
    if (country !== null) update.country = country;
    const { error } = await supabase.from("competitions").update(update).eq("id", existing);
    if (error) throw error;
    return existing;
  }

  const { data, error } = await supabase.rpc("upsert_competition_with_mapping", {
    p_provider: provider,
    p_provider_entity_id: competitionProviderId,
    p_name: name,
  });
  if (error || !data) throw error ?? new Error("upsert_competition_with_mapping returned no id");

  // A second write rather than a parameter on the RPC. The RPC is shared with
  // other callers and changing its signature means dropping and recreating a
  // SECURITY DEFINER function that several agents' code calls; the atomicity it
  // exists for is the competition/mapping pair, which is unaffected. If this
  // update fails the competition simply keeps a null country and the next sync
  // fills it — a strictly better failure than an orphaned competition row.
  if (country !== null) {
    const { error: countryError } = await supabase.from("competitions").update({ country }).eq("id", data);
    if (countryError) throw countryError;
  }

  knownMappings.set(competitionProviderId, data);
  return data;
}

/** Seasons aren't provider-mapped (the provider only reports a bare year, no
 * stable season id) — deduped instead on the table's own (competition_id, name)
 * unique constraint, same race-safe select/insert/re-select shape as profile.ts.
 *
 * `name` is the "YYYY/YYYY+1" display string the seasons.name column comment
 * (migration 0001) has always promised — it's genuinely rendered to users
 * (teams/[id]'s "League position" card, admin/data-health's gameweek list).
 * `provider_year` (migration 0028) is the bare year the dedupe key and every
 * provider-facing lookup (syncStandings in sync-match-details.ts) should read
 * instead of parsing it back out of `name` — see RECOMMENDATIONS.md item 30.
 *
 * Every fixture sync only ever asks for *today's* fixtures (see
 * syncTodayFixtures below), so whatever season year the provider reports for a
 * competition right now is, by definition, that competition's current season —
 * there is no other signal to use. Mark it current every time this runs, and
 * unset every other season for the same competition first: the DB enforces at
 * most one current season per competition (idx_seasons_one_current_per_competition),
 * and unsetting-then-setting (rather than the reverse) never has both a old and
 * a new row simultaneously true, so it can never trip that constraint mid-update.
 * Without this, `is_current` stays permanently false forever (its column
 * default), which is exactly what made "/fantasy" and every team's "League
 * position" permanently empty — see RECOMMENDATIONS.md item 1. */
async function upsertSeason(supabase: ServiceClient, competitionId: string, seasonYear: number): Promise<string> {
  const name = `${seasonYear}/${seasonYear + 1}`;

  const { data: existing, error: selectError } = await supabase
    .from("seasons")
    .select("id")
    .eq("competition_id", competitionId)
    .eq("name", name)
    .maybeSingle();
  if (selectError) throw selectError;

  let seasonId: string;
  if (existing) {
    seasonId = existing.id;
  } else {
    const { data: created, error: insertError } = await supabase
      .from("seasons")
      .insert({ competition_id: competitionId, name, provider_year: seasonYear })
      .select("id")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        const { data: retried, error: retryError } = await supabase
          .from("seasons")
          .select("id")
          .eq("competition_id", competitionId)
          .eq("name", name)
          .maybeSingle();
        if (retryError) throw retryError;
        if (!retried) throw insertError;
        seasonId = retried.id;
      } else {
        throw insertError;
      }
    } else if (!created) {
      throw new Error("Failed to insert season");
    } else {
      seasonId = created.id;
    }
  }

  const { error: unsetError } = await supabase
    .from("seasons")
    .update({ is_current: false })
    .eq("competition_id", competitionId)
    .eq("is_current", true)
    .neq("id", seasonId);
  if (unsetError) throw unsetError;

  const { error: setCurrentError } = await supabase
    .from("seasons")
    .update({ is_current: true })
    .eq("id", seasonId)
    .eq("is_current", false);
  if (setCurrentError) throw setCurrentError;

  return seasonId;
}

/**
 * KIVO_NEXT_GEN KN-10: `upsertSeason` above is three round trips (a select and
 * two updates) and was called once per fixture, unconditionally — even when the
 * previous fixture in the same loop had already resolved the identical
 * `(competition, season)` pair. Every fixture in a competition on a given day
 * shares one season, so a 300-fixture day spent roughly 900 round trips
 * re-deciding the same handful of answers. Item 27's batching pass reached
 * competition/team/venue and missed this one.
 *
 * Two layers, both needed, for two different reasons:
 *
 *  - **Memoized on the promise, not the value** (`createAsyncMemo`). A plain
 *    `Map<key, id>` would fix the sequential loop this replaced, but the loop is
 *    now a bounded worker pool (KN-11) where several lanes reach the same
 *    unresolved key before any of them has filled the map. Sharing the in-flight
 *    promise is what makes "once per pair" true under concurrency too.
 *  - **Serialized per competition** (`createKeyedSerializer`). `upsertSeason`'s
 *    two `is_current` writes are only safe against
 *    `idx_seasons_one_current_per_competition` (at most one current season per
 *    competition) while no other season of the *same* competition is being
 *    flipped concurrently. Two different years of one competition are two
 *    different memo keys, so the memo alone would happily interleave them.
 *
 * Scoped to one sync run — a fresh resolver per call of syncTodayFixtures, never
 * a module-level cache, so a season that changes between runs is re-read.
 */
function createSeasonResolver(supabase: ServiceClient) {
  const memo = createAsyncMemo<string, string>();
  const serializePerCompetition = createKeyedSerializer<string>();
  return (competitionId: string, seasonYear: number): Promise<string> =>
    memo(`${competitionId}:${seasonYear}`, () =>
      serializePerCompetition(competitionId, () => upsertSeason(supabase, competitionId, seasonYear)),
    );
}

/** `name` is nullable (migration 0017) rather than backfilled with a fabricated
 * "Unknown venue" string — a provider id with no reported name stays honestly
 * unnamed. Never overwrites a real name with a later null, same rule as
 * upsertPlayer in sync-squads.ts. `knownMappings` is the batched lookup from
 * batchFindMappedIds — see its doc comment.
 *
 * The new-entity branch goes through upsert_venue_with_mapping (migration
 * 0018) so a mapping insert failure can no longer leave an orphan, unmapped
 * venue row behind (RECOMMENDATIONS.md item 22). */
async function upsertVenue(
  supabase: ServiceClient,
  provider: string,
  venueProviderId: string,
  name: string | null,
  /** Migration 0113. `venues.city` has existed since 0001 and nothing ever
   * wrote to it from a fixture sync, because the adapter did not declare the
   * field the provider was already sending. */
  city: string | null,
  knownMappings: Map<string, string>,
): Promise<string> {
  const existing = knownMappings.get(venueProviderId) ?? null;
  if (existing) {
    // Each field only when it has something to say. Same never-clobber rule as
    // everywhere else: a payload without a city must not erase one.
    const update: Database["public"]["Tables"]["venues"]["Update"] = {};
    if (name !== null) update.name = name;
    if (city !== null) update.city = city;
    if (Object.keys(update).length > 0) {
      const { error } = await supabase.from("venues").update(update).eq("id", existing);
      if (error) throw error;
    }
    return existing;
  }

  // p_name is an optional RPC arg backed by a `default null` SQL parameter
  // (migration 0018) — the generated Args type is `p_name?: string`, never
  // `string | null` (Postgres has no not-null concept for a plain function
  // argument), so a null name is conveyed by omitting the key entirely rather
  // than by passing null through it.
  const args: Database["public"]["Functions"]["upsert_venue_with_mapping"]["Args"] = {
    p_provider: provider,
    p_provider_entity_id: venueProviderId,
  };
  if (name !== null) args.p_name = name;
  if (city !== null) args.p_city = city;

  const { data, error } = await supabase.rpc("upsert_venue_with_mapping", args);
  if (error || !data) throw error ?? new Error("upsert_venue_with_mapping returned no id");

  knownMappings.set(venueProviderId, data);
  return data;
}

/** Updates name on every sync (always provided). short_name/crest_url only
 * overwrite when the provider actually reported one this time — same
 * never-clobber-with-null rule as upsertPlayer in sync-squads.ts, so a crest
 * an admin filled in by hand never gets nulled out by a leaner provider response.
 * `knownMappings` is the batched lookup from batchFindMappedIds — see its doc comment.
 *
 * The new-entity branch goes through upsert_team_with_mapping (migration 0018)
 * so a mapping insert failure can no longer leave an orphan team row behind
 * (RECOMMENDATIONS.md item 22). */
async function upsertTeam(
  supabase: ServiceClient,
  provider: string,
  team: NormalizedTeam,
  knownMappings: Map<string, string>,
): Promise<string> {
  const existing = knownMappings.get(team.providerId) ?? null;
  if (existing) {
    const update: Database["public"]["Tables"]["teams"]["Update"] = { name: team.name };
    if (team.shortName !== null) update.short_name = team.shortName;
    if (team.crestUrl !== null) update.crest_url = team.crestUrl;

    const { error } = await supabase.from("teams").update(update).eq("id", existing);
    if (error) throw error;
    return existing;
  }

  // p_short_name/p_crest_url are optional RPC args for the same reason as
  // upsert_venue_with_mapping's p_name above — see its comment.
  const args: Database["public"]["Functions"]["upsert_team_with_mapping"]["Args"] = {
    p_provider: provider,
    p_provider_entity_id: team.providerId,
    p_name: team.name,
  };
  if (team.shortName !== null) args.p_short_name = team.shortName;
  if (team.crestUrl !== null) args.p_crest_url = team.crestUrl;

  const { data, error } = await supabase.rpc("upsert_team_with_mapping", args);
  if (error || !data) throw error ?? new Error("upsert_team_with_mapping returned no id");

  knownMappings.set(team.providerId, data);
  return data;
}

interface ResolvedFixtureRefs {
  competitionId: string;
  seasonId: string;
  homeTeamId: string;
  awayTeamId: string;
  venueId: string | null;
}

/**
 * Update-in-place when already mapped, insert-plus-map otherwise — both branches
 * (and the findMappedId lookup that used to pick between them) now live inside
 * upsert_fixture_with_mapping (migration 0018), one round trip either way. Unlike
 * competition/team/venue above there's no batched knownMappings map here: every
 * fixture's provider id is unique to that fixture, so there's no within-batch
 * reuse to short-circuit, and folding the lookup into the RPC also closes the
 * same orphan-fixture-row gap item 22 describes (a mapping insert failing right
 * after the fixture insert had already committed on its own round trip). */
async function upsertFixture(
  supabase: ServiceClient,
  provider: string,
  fixture: NormalizedFixture,
  refs: ResolvedFixtureRefs,
  previousStatus: DbFixtureStatus | null,
  previousScores: { homeScore: number | null; awayScore: number | null } | null,
  /** The name of a DIFFERENT provider that also maps this fixture, or null
   * when this fixture has only ever been written by the provider syncing now.
   * What separates "a source revised itself" from "two sources disagree". */
  previousWrittenBy: string | null,
  syncRunId: string,
): Promise<FixtureStatusChangeInput | null> {
  // RECOMMENDATIONS.md item 303 ("conflict detection"): a same-provider
  // sanity check, not a second-provider merge (there's no second source to
  // reconcile against yet — see DECISIONS.md's provider-failover entry).
  // Flags, never blocks: the write below still lands either way, since a
  // false positive here (e.g. a legitimate admin correction) shouldn't drop
  // real provider data.
  //
  // KIVO_NEXT_GEN KN-95: the *detection* below is unchanged; where it lands
  // is. It used to exist only as a console.warn, which made the anomaly
  // visible to whoever happened to be tailing a server log and to nobody
  // else — so "3 fixtures had a score regress this week", the sentence the
  // founding brief's conflict detection is meant to be able to say, could not
  // be said. Each detection is collected here and written to `data_anomalies`
  // after the upsert (see below), carrying both values that disagreed. The
  // console line stays: it is what a developer watching a live sync reads.
  const anomalies: {
    type: Database["public"]["Enums"]["data_anomaly_type"];
    detail: string;
    previous: Json;
    next: Json;
  }[] = [];
  const fixtureLabel = `${fixture.homeTeam.name} v ${fixture.awayTeam.name}`;

  if (previousScores) {
    if (
      fixture.homeScore !== null &&
      previousScores.homeScore !== null &&
      fixture.homeScore < previousScores.homeScore
    ) {
      anomalies.push({
        type: "score_regression",
        detail: `Home score decreased ${previousScores.homeScore} -> ${fixture.homeScore} (${fixtureLabel})`,
        previous: { home_score: previousScores.homeScore },
        next: { home_score: fixture.homeScore },
      });
    }
    if (
      fixture.awayScore !== null &&
      previousScores.awayScore !== null &&
      fixture.awayScore < previousScores.awayScore
    ) {
      anomalies.push({
        type: "score_regression",
        detail: `Away score decreased ${previousScores.awayScore} -> ${fixture.awayScore} (${fixtureLabel})`,
        previous: { away_score: previousScores.awayScore },
        next: { away_score: fixture.awayScore },
      });
    }
  }
  if (previousStatus === "finished" && toDbFixtureStatus(fixture.status) !== "finished") {
    anomalies.push({
      type: "status_regression",
      detail: `Status regressed from finished to ${fixture.status} (${fixtureLabel})`,
      previous: { status: previousStatus },
      next: { status: toDbFixtureStatus(fixture.status) },
    });
  }

  // Two sources disagreeing about the same fact. Only reachable when another
  // provider has really written this fixture before — otherwise a changed
  // value is one provider revising itself, which the regression checks above
  // already cover and which is not a disagreement.
  //
  // Every field compared here is one both providers claim to know. A value
  // KIVO holds but the incoming provider did not send (null) is silence, not
  // a contradiction, so it is skipped rather than reported as a conflict.
  if (previousWrittenBy && previousScores) {
    const incomingStatus = toDbFixtureStatus(fixture.status);
    const disagreements: { field: string; previous: Json; next: Json }[] = [];

    if (
      fixture.homeScore !== null &&
      previousScores.homeScore !== null &&
      fixture.homeScore !== previousScores.homeScore
    ) {
      disagreements.push({
        field: "home_score",
        previous: { home_score: previousScores.homeScore },
        next: { home_score: fixture.homeScore },
      });
    }
    if (
      fixture.awayScore !== null &&
      previousScores.awayScore !== null &&
      fixture.awayScore !== previousScores.awayScore
    ) {
      disagreements.push({
        field: "away_score",
        previous: { away_score: previousScores.awayScore },
        next: { away_score: fixture.awayScore },
      });
    }
    if (previousStatus !== null && previousStatus !== incomingStatus) {
      disagreements.push({
        field: "status",
        previous: { status: previousStatus },
        next: { status: incomingStatus },
      });
    }

    for (const disagreement of disagreements) {
      anomalies.push({
        type: "provider_disagreement",
        detail:
          `${provider} and ${previousWrittenBy} disagree on ${disagreement.field} ` +
          `for ${fixtureLabel}: ${JSON.stringify(disagreement.previous)} vs ${JSON.stringify(disagreement.next)}`,
        previous: disagreement.previous,
        next: disagreement.next,
      });
    }
  }
  for (const anomaly of anomalies) {
    console.warn(`Football sync anomaly: ${provider}:${fixture.providerId} ${anomaly.detail}`);
  }
  // p_venue_id/p_home_score/p_away_score/p_home_score_ht/p_away_score_ht/
  // p_minute_elapsed are optional RPC args for the same reason as
  // upsert_venue_with_mapping's p_name — see its comment. Omitting them
  // (rather than passing null explicitly) still lands as null inside the
  // function once Postgres substitutes each parameter's `default null`, so
  // this is exactly equivalent to the old payload object always carrying
  // fixture.homeScore/awayScore/refs.venueId verbatim, null or not.
  //
  // home_score_ht/away_score_ht/minute_elapsed (migration 0028,
  // RECOMMENDATIONS.md items 57/58) are wired through the same way: real
  // provider data when the provider reports it, left null (never guessed)
  // otherwise — see the doc comments on NormalizedFixture in types.ts.
  const args: Database["public"]["Functions"]["upsert_fixture_with_mapping"]["Args"] = {
    p_provider: provider,
    p_provider_entity_id: fixture.providerId,
    p_competition_id: refs.competitionId,
    p_season_id: refs.seasonId,
    p_home_team_id: refs.homeTeamId,
    p_away_team_id: refs.awayTeamId,
    p_status: toDbFixtureStatus(fixture.status),
    p_kickoff_at: fixture.kickoffAt,
  };
  if (refs.venueId !== null) args.p_venue_id = refs.venueId;
  if (fixture.homeScore !== null) args.p_home_score = fixture.homeScore;
  if (fixture.awayScore !== null) args.p_away_score = fixture.awayScore;
  if (fixture.homeScoreHt !== null) args.p_home_score_ht = fixture.homeScoreHt;
  if (fixture.awayScoreHt !== null) args.p_away_score_ht = fixture.awayScoreHt;
  if (fixture.minute !== null) args.p_minute_elapsed = fixture.minute;
  // KIVO_NEXT_GEN KN-84. `fixtures.matchday` has existed since migration 0001
  // with a doc comment promising a round/gameweek number, and nothing had ever
  // written to it — no normalizer read the provider's round, and this RPC did
  // not carry it. Omitted (rather than passed as null) when the provider gives
  // no numbered round, which is what lets the function's own coalesce keep a
  // number an earlier sync legitimately established. See parseMatchday in
  // ./matchday.ts for why a cup round is null and never a guess.
  if (fixture.matchday !== null) args.p_matchday = fixture.matchday;
  // Migration 0113. Both arrive on the same /fixtures payload KIVO already
  // pays for and were dropped by the adapter until now. Omitted rather than
  // passed as null when the provider reports neither, so the function's own
  // coalesce keeps a value an earlier, richer sync established — a live-score
  // refresh must not blank the referee mid-match.
  if (fixture.referee !== null) args.p_referee = fixture.referee;
  if (fixture.roundLabel !== null) args.p_round_label = fixture.roundLabel;

  const { data: kivoFixtureId, error } = await supabase.rpc("upsert_fixture_with_mapping", args);
  if (error) throw error;

  // Persisted after the write, never before: an anomaly row pointing at a
  // fixture whose write then failed would be a record of something that never
  // happened. recordAnomaly is best-effort by contract (see its module doc) —
  // failing to log a conflict must not fail the sync that detected it.
  for (const anomaly of anomalies) {
    await recordAnomaly(supabase, {
      anomalyType: anomaly.type,
      provider,
      entityType: "fixture",
      detail: anomaly.detail,
      syncRunId,
      providerEntityId: fixture.providerId,
      kivoEntityId: kivoFixtureId,
      previousValue: anomaly.previous,
      newValue: anomaly.next,
    });
  }

  // RECOMMENDATIONS.md notification items: kickoff/full-time, described by the
  // exact status write this function just made, using the real KIVO fixture id
  // the RPC itself returns (not the provider id) — see
  // notifyFixtureStatusChange's own doc comment for why `previousStatus`
  // (looked up once per whole run, see syncTodayFixtures) has to be known and
  // different from the new status before it does anything.
  //
  // KIVO_NEXT_GEN KN-11: this used to *await* that fan-out here, inside the
  // write path, so a club with real followers put its whole audience query and
  // insert between two fixture writes. The fan-out is unchanged, it just runs
  // after the run has been recorded as finished — described here, dispatched
  // there. Football data landing in the database is the part that must survive
  // a function timeout; a notification is not worth blocking it for.
  if (!kivoFixtureId) return null;
  return {
    fixtureId: kivoFixtureId,
    homeTeamId: refs.homeTeamId,
    awayTeamId: refs.awayTeamId,
    homeTeamName: fixture.homeTeam.name,
    awayTeamName: fixture.awayTeam.name,
    previousStatus,
    newStatus: toDbFixtureStatus(fixture.status),
    homeScore: fixture.homeScore,
    awayScore: fixture.awayScore,
  };
}

/**
 * KN-32 deliberately does NOT reach this function, and it is worth saying why
 * rather than leaving it looking like a site that was missed.
 *
 * Every other "today" in the app answers a question on behalf of a specific
 * person, so it belongs in that person's timezone. This one does not: it is the
 * date parameter of a provider request, made by a background job with no
 * viewer. API-Football's `?date=` is its own calendar convention, and asking it
 * for "the day it is in Lagos" would mean the set of fixtures KIVO holds
 * depends on whichever user happened to trigger a sync — which is worse than a
 * boundary being off, because it makes the database's contents non-deterministic.
 *
 * The user-facing boundaries do the right thing on top of this. `kickoff_at` is
 * a `timestamptz` naming a real instant, so a page querying a local day's range
 * is exact regardless of which UTC date the row was fetched under.
 */
function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `YYYY-MM-DD`, the only shape FootballDataProvider.getFixturesByDate accepts
 * and the same shape `/matches?date=` uses. Validated rather than trusted: this
 * value reaches a provider URL, and a malformed one produces a confusing
 * provider error rather than a clear refusal. */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidSyncDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Sync of today's fixtures — admin-triggered (Data Health's "Sync now",
 * `triggerLiveScoresRefresh`) or, since the Vercel Cron worker
 * (`src/app/api/cron/sync-live/route.ts`), cron-triggered when that route
 * decides something live/imminent is actually worth a provider call. Never a
 * blind timer/loop regardless of state — see FOOTBALL_LIVE_POLLING_ENABLED in
 * ./index.ts and the cron route's own doc comment for the adaptive logic that
 * decides *whether* to call this at all. Single call to getFixturesByDate()
 * per run (quota-conscious), writes go through the service-role client per
 * the schema's RLS design (see supabase/migrations/0001, "a future sync job
 * should use the service_role key"). A bad fixture never aborts the whole
 * batch; every fixture-level failure is caught, logged and rolled into the
 * run's error_message instead.
 *
 * `triggerSource` (migration 0044) is carried straight onto the sync_runs
 * row so Data Health can show the automated worker's run history distinct
 * from admin-triggered ones — defaults to "manual" so every existing caller
 * (none of which pass it) keeps writing exactly what it always has.
 *
 * Competition/team/venue provider_mappings lookups are batched once up front across the
 * whole fixtures array (RECOMMENDATIONS.md item 27) rather than re-queried per fixture —
 * an unfiltered day can be hundreds of fixtures, and this turns the ~6 sequential round
 * trips per fixture that used to invite a server-action timeout into 3 batch lookups plus
 * per-fixture work that's now limited to season/fixture resolution and inserts for
 * whatever competitions/teams/venues actually turned out to be new.
 */
/**
 * Bounded concurrency for the per-fixture write loop (KIVO_NEXT_GEN KN-11).
 *
 * The loop was fully sequential: every upsert awaited in series, hundreds of
 * fixtures deep, on a serverless function with a wall-clock timeout — the shape
 * most likely to be killed part-way through, which is exactly what used to
 * leave KN-4's `running` row behind. `Promise.all` over the whole array is not
 * the answer either: an unfiltered day is hundreds of fixtures and each one
 * issues several statements, so an unbounded burst just moves the failure from
 * "too slow" to "too many connections".
 *
 * Six is chosen against a real constraint rather than picked for feel: Supabase
 * pools connections per project and this runs on the service-role client shared
 * with everything else the server is doing, so the pool — not KIVO — is the
 * scarce resource. Six keeps a comfortable margin under any plausible pool size
 * while still collapsing a 300-fixture day from 300 serial waits to ~50. The
 * provider is not a factor here: the whole day is fetched in one request before
 * this loop starts, so no amount of concurrency in it spends extra quota.
 */
const FIXTURE_WRITE_CONCURRENCY = 6;

/**
 * Lower than the write pool on purpose: each of these fans out to an audience
 * query plus a bulk insert, and it runs after the sync is already recorded as
 * finished, so there is nothing to race it to a deadline.
 */
const NOTIFICATION_FANOUT_CONCURRENCY = 3;

/**
 * KIVO_NEXT_GEN KN-11: kickoff/full-time notifications used to be awaited
 * inside `upsertFixture`, between two fixture writes. They now run here, after
 * the run row has already reached a terminal status, so a slow or failing
 * fan-out can neither delay football data landing in the database nor leave the
 * run looking unfinished if the function is killed. Every failure is contained
 * per fixture — a notification is the least important thing happening in this
 * file and must never be able to fail a sync that actually wrote its data.
 */
async function dispatchStatusNotifications(
  supabase: ServiceClient,
  notifications: FixtureStatusChangeInput[],
): Promise<void> {
  if (notifications.length === 0) return;
  await mapWithConcurrency(notifications, NOTIFICATION_FANOUT_CONCURRENCY, async (input) => {
    try {
      await notifyFixtureStatusChange(supabase, input);
    } catch (err) {
      logError("football.sync.notificationFanOutFixture", err, { detail: `Football sync: notification fan-out failed for fixture ${input.fixtureId}` });
    }
  });
}

/**
 * KIVO_NEXT_GEN KN-31. `targetDate` is the fix for a calendar that could never
 * be filled. `/matches` accepts `?date=YYYY-MM-DD` and MatchesDateStrip offers
 * a seven-day window, but this function — the only writer of `fixtures` — always
 * asked the provider for `todayIsoDate()`. So every other day the strip offered
 * was structurally guaranteed to be empty forever, no matter how often an admin
 * synced. That is not a "not synced yet" state; it is a state that cannot
 * resolve.
 *
 * Defaults to today, so every existing caller (the cron worker, the admin "Sync
 * now" button, the daily pass) behaves exactly as before. Only the new
 * date-scoped admin action passes anything else.
 */
export async function syncTodayFixtures(
  triggerSource: SyncTriggerSource = "manual",
  options?: {
    targetDate?: string;
    /**
     * Which endpoint supplies this run's fixtures.
     *
     *   "date" (default) — `/fixtures?date=`, a whole day's fixtures.
     *   "live"           — `/fixtures?live=all`, only what is in play.
     *
     * Both cost one request and land in the identical write path, which is the
     * point: the live worker is a new CALLER, not a new sync. Everything below
     * — the lease, the batched mappings, the score-regression check, the
     * notification fan-out, Realtime distribution — is already proven and is
     * shared unchanged.
     *
     * Two things differ, and both are handled explicitly rather than left to
     * behave-as-if: `targetDate` is meaningless for a live run, and the
     * absence check must not run (see where it is skipped below).
     */
    source?: "date" | "live";
  },
): Promise<SyncResult> {
  const source = options?.source ?? "date";
  const targetDate = options?.targetDate ?? todayIsoDate();
  if (!isValidSyncDate(targetDate)) {
    return { status: "failed", recordsProcessed: 0, error: `Invalid sync date "${targetDate}". Expected YYYY-MM-DD.` };
  }

  const supabase = createServiceRoleSupabaseClient();
  const provider = await getFootballDataProvider();

  // Before opening a new row, close any that a dead process left open. This is
  // the one place guaranteed to run often enough to matter and cheap enough to
  // afford: one indexed UPDATE that touches nothing unless a row has been
  // `running` for a quarter of an hour. See reapAbandonedSyncRuns for why the
  // `finally` below cannot cover the case this does.
  await reapAbandonedSyncRuns(supabase);

  const { data: syncRun, error: startError } = await supabase
    .from("sync_runs")
    .insert({ provider: provider.name, entity_type: "fixture", status: "running", trigger_source: triggerSource })
    .select("id")
    .single();

  if (startError || !syncRun) {
    logError("football.sync.startRun", startError);
    return {
      status: "failed",
      recordsProcessed: 0,
      error: startError?.message ?? "Could not create sync_runs row",
    };
  }

  /**
   * KIVO_NEXT_GEN KN-82: two overlapping runs used to be prevented only by the
   * cron route's "is there a `running` cron row from the last two minutes"
   * query — a heuristic, not a lock, and one KN-4 showed a stuck row could
   * poison. This is the real thing: a lease on (provider, entity_type), held
   * for the duration of the run and released in `finally`.
   *
   * It also covers a case the old heuristic never did. That query only ever
   * looked at `trigger_source = 'cron'` rows, so an admin clicking "Sync now"
   * while the worker was mid-run collided freely — both spending provider
   * quota on the same fixtures. The lease is keyed on the work, not on who
   * asked for it, so manual and automated runs now exclude each other too.
   *
   * A refused claim is a first-class outcome, recorded as a `skipped` run with
   * a plain-English reason (the same convention the cron route already uses
   * for every no-op it makes), not an error.
   */
  // Captured once, before any work: KN-86's absence check compares each
  // fixture's `provider_last_seen_at` against the moment this run began, so it
  // must not drift as the run progresses.
  const runStartedAt = new Date().toISOString();

  const lock = await claimSyncLock(supabase, provider.name, "fixture", {
    holder: triggerSource,
    syncRunId: syncRun.id,
  });

  if (!lock) {
    await supabase
      .from("sync_runs")
      .update({
        status: "skipped",
        finished_at: new Date().toISOString(),
        records_processed: 0,
        records_failed: 0,
        error_message: "Skipped: another fixtures sync run currently holds the lock for this provider.",
      })
      .eq("id", syncRun.id);
    return { status: "succeeded", recordsProcessed: 0, error: undefined };
  }

  /**
   * KIVO_NEXT_GEN KN-4: the run row above is inserted as `running`, and before
   * this it was only ever updated on two paths — a `getFixturesByDate` failure,
   * and a clean finish. Everything in between could throw straight out of the
   * function (`batchFindMappedIds` rethrows any PostgREST error, the prior-status
   * lookup did a bare `if (priorError) throw priorError`), and on that path the
   * row stayed `running` forever: Data Health showed a phantom in-progress sync
   * permanently, and the cron worker's dedup query — which treats an
   * already-`running` cron run as live work — suppressed the next real run.
   *
   * So: one funnel, called from the success path, from the catch, and from a
   * `finally` that only fires if neither of those got there. The run row cannot
   * be left non-terminal by any exit this function has.
   */
  let finalized = false;
  let processed = 0;
  const finalizeRun = async (fields: Database["public"]["Tables"]["sync_runs"]["Update"]): Promise<void> => {
    if (finalized) return;
    finalized = true;
    const { error } = await supabase
      .from("sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        // RECOMMENDATIONS.md item 53: real quota data on every terminal path,
        // not just the two that used to write it — a rate-limited or otherwise
        // non-OK response still carries a remaining count (see
        // ApiFootballError.quotaRemaining in api-football-request.ts).
        provider_quota_remaining: provider.getQuotaRemaining(),
        // RECOMMENDATIONS.md item 65: likewise for the raw response sample. It
        // is most valuable on exactly the failure paths that previously wrote
        // nothing at all — "what did the provider actually send back" is the
        // first question an admin asks about a run that died mid-way.
        raw_response_sample: provider.getLastRawResponseSample() as Json | null,
        ...fields,
      })
      .eq("id", syncRun.id);
    if (error) logError("football.sync.writeTerminalRunsStatus", error);
  };

  const pendingNotifications: FixtureStatusChangeInput[] = [];
  let result: SyncResult;

  try {
    let fixtures: NormalizedFixture[];
    try {
      fixtures = source === "live" ? await provider.getLiveFixtures() : await provider.getFixturesByDate(targetDate);
    } catch (err) {
      logError(source === "live" ? "football.sync.getlivefixtures" : "football.sync.getfixturesbydate", err);
      throw err;
    }

    // Scope the whole run to the effective competition allowlist — see
    // competitions-config.ts for what that list is, where its default came
    // from, and how to override or disable it. Filtering the already-fetched
    // response rather than issuing one provider request per league is
    // deliberate and costs zero extra quota either way; filtering HERE, before
    // any of the mapping/upsert work below, is what keeps competitions, teams
    // and venues outside the scope from ever being written at all rather than
    // merely hidden from the UI afterwards.
    //
    // The provider name is passed because the default list is API-Football's
    // own numbering and means something else entirely under another provider's
    // ids.
    // Resolved against `competition_scope` first (migration 0114), so an
    // operator can add a competition by picking it out of the provider's own
    // registry rather than by anyone typing a league id — and falls back to
    // the env var and then the shipped default exactly as before. A failed
    // read returns the static scope, never an empty one: an empty allowlist
    // would scope every sync to zero and read as "there is no football".
    const syncedCompetitionIds = await resolveSyncedCompetitionProviderIds(supabase, provider.name);
    const fixturesBeforeScoping = fixtures.length;
    if (syncedCompetitionIds) {
      fixtures = fixtures.filter((f) => syncedCompetitionIds.has(f.competitionProviderId));
    }
    const scopedOutCount = fixturesBeforeScoping - fixtures.length;
    if (scopedOutCount > 0) {
      console.info(
        `Football sync: scoped out ${scopedOutCount}/${fixturesBeforeScoping} fixtures outside the competition allowlist (see FOOTBALL_SYNC_COMPETITION_IDS)`,
      );
    }

    // RECOMMENDATIONS.md item 27: resolve every distinct competition/team/venue
    // provider id this whole batch needs in three round trips total, up front,
    // instead of a findMappedId query per entity per fixture. The per-fixture loop
    // below then only issues an insert for provider ids that came back missing,
    // and only ever hits provider_mappings again to write those new rows.
    const competitionProviderIds = Array.from(new Set(fixtures.map((f) => f.competitionProviderId)));
    const teamProviderIds = Array.from(new Set(fixtures.flatMap((f) => [f.homeTeam.providerId, f.awayTeam.providerId])));
    const venueProviderIds = Array.from(
      new Set(fixtures.map((f) => f.venueProviderId).filter((id): id is string => id !== null)),
    );

    const [competitionMappings, teamMappings, venueMappings] = await Promise.all([
      batchFindMappedIds(supabase, provider.name, "competition", competitionProviderIds),
      batchFindMappedIds(supabase, provider.name, "team", teamProviderIds),
      batchFindMappedIds(supabase, provider.name, "venue", venueProviderIds),
    ]);

    // Notification items (kickoff/full-time): batch-resolve each fixture's
    // real prior status the same up-front way as the mappings above, one
    // extra round trip for the whole run rather than one per fixture. A
    // provider id with no existing mapping is a fixture KIVO has never synced
    // before — its entry is simply absent from this map, and
    // notifyFixtureStatusChange treats "no known prior status" as "don't
    // guess, don't notify" (see its doc comment).
    const fixtureProviderIds = Array.from(new Set(fixtures.map((f) => f.providerId)));
    const fixtureMappings = await batchFindMappedIds(supabase, provider.name, "fixture", fixtureProviderIds);
    const priorStatusByKivoId = new Map<string, DbFixtureStatus>();
    // RECOMMENDATIONS.md item 303 ("conflict detection"): the same batched
    // lookup above already fetches each known fixture's prior status for
    // notifications — carrying its scores along too costs nothing extra (same
    // row, same round trip) and is what upsertFixture below uses for a
    // same-provider sanity check (a score that would go backward is a real
    // anomaly signal, never silently written over).
    const priorScoresByKivoId = new Map<string, { homeScore: number | null; awayScore: number | null }>();
    const knownKivoFixtureIds = Array.from(fixtureMappings.values());
    if (knownKivoFixtureIds.length > 0) {
      const { data: priorRows, error: priorError } = await supabase
        .from("fixtures")
        .select("id, status, home_score, away_score")
        .in("id", knownKivoFixtureIds);
      if (priorError) throw priorError;
      for (const row of priorRows ?? []) {
        priorStatusByKivoId.set(row.id, row.status);
        priorScoresByKivoId.set(row.id, { homeScore: row.home_score, awayScore: row.away_score });
      }
    }

    // KIVO_NEXT_GEN: the producer `provider_disagreement` never had.
    // `data_anomaly_type` has carried that value since migration 0056 and the
    // admin panel has a label for it, and nothing in the codebase ever wrote
    // one — so the one anomaly the founding brief names most explicitly was
    // the one KIVO could not report.
    //
    // The distinction that makes it meaningful: a value changing under the
    // SAME provider is that provider revising itself (already covered by the
    // score/status regression checks). A value differing from what a
    // DIFFERENT provider wrote is two sources disagreeing about a fact, which
    // is a different problem with a different fix.
    //
    // One batched query for the whole run, same shape as the prior-state
    // lookup above. Today this map is almost always empty, because KIVO runs
    // one provider at a time (see DECISIONS.md's provider-failover entry) —
    // and it stops being empty the moment a second provider is switched on,
    // which is exactly when somebody needs it and is too late to build it.
    const otherProviderByKivoFixtureId = new Map<string, string>();
    if (knownKivoFixtureIds.length > 0) {
      const { data: otherMappings, error: otherMappingError } = await supabase
        .from("provider_mappings")
        .select("kivo_entity_id, provider")
        .eq("entity_type", "fixture")
        .neq("provider", provider.name)
        .in("kivo_entity_id", knownKivoFixtureIds);
      // Best-effort, exactly like recordAnomaly itself: failing to detect a
      // disagreement must never fail the sync that would have reported it.
      if (otherMappingError) {
        logError("football.sync.loadOtherProviderMappings", otherMappingError);
      }
      for (const row of otherMappings ?? []) {
        otherProviderByKivoFixtureId.set(row.kivo_entity_id, row.provider);
      }
    }

    const errors: string[] = [];
    /**
     * KIVO_NEXT_GEN KN-81. `errors` above still builds the truncated,
     * human-readable `error_message` blob, because that is what an admin skims.
     * This is the queryable half: one row per failed entity, so "fixture 47 of
     * 300 failed" becomes a retryable list instead of a sentence that gets cut
     * off after the twentieth failure and drops the rest entirely.
     */
    const entityFailures: EntityFailure[] = [];
    /** Provider ids that actually landed this run — used for two things after
     * the loop: closing previously-open failures for those same entities
     * (KN-81), and knowing which fixtures the provider genuinely reported so
     * the rest can be considered for an absence flag (KN-86). */
    const succeededProviderIds: string[] = [];
    const seenFixtureIds: string[] = [];
    /** Set if this run's lease is taken over mid-flight, which can only happen
     * if the run outlived its lease. Continuing past that point would mean two
     * workers writing the same fixtures — exactly what the lease exists to
     * stop — so the remaining fixtures are abandoned and the run is honest
     * about being partial. */
    let lostLease = false;
    const resolveSeason = createSeasonResolver(supabase);

    await mapWithConcurrency(fixtures, FIXTURE_WRITE_CONCURRENCY, async (fixture) => {
      if (lostLease) return;
      try {
        const competitionId = await upsertCompetition(
          supabase,
          provider.name,
          fixture.competitionProviderId,
          fixture.competitionName,
          fixture.competitionCountry,
          competitionMappings,
        );
        const seasonId = await resolveSeason(competitionId, fixture.season);
        const [homeTeamId, awayTeamId, venueId] = await Promise.all([
          upsertTeam(supabase, provider.name, fixture.homeTeam, teamMappings),
          upsertTeam(supabase, provider.name, fixture.awayTeam, teamMappings),
          fixture.venueProviderId
            ? upsertVenue(
                supabase,
                provider.name,
                fixture.venueProviderId,
                fixture.venueName,
                fixture.venueCity,
                venueMappings,
              )
            : Promise.resolve(null),
        ]);

        const knownKivoId = fixtureMappings.get(fixture.providerId) ?? null;
        const previousStatus = knownKivoId ? (priorStatusByKivoId.get(knownKivoId) ?? null) : null;
        const previousScores = knownKivoId ? (priorScoresByKivoId.get(knownKivoId) ?? null) : null;
        const previousWrittenBy = knownKivoId ? (otherProviderByKivoFixtureId.get(knownKivoId) ?? null) : null;

        const notification = await upsertFixture(
          supabase,
          provider.name,
          fixture,
          {
            competitionId,
            seasonId,
            homeTeamId,
            awayTeamId,
            venueId,
          },
          previousStatus,
          previousScores,
          previousWrittenBy,
          syncRun.id,
        );
        if (notification) {
          pendingNotifications.push(notification);
          seenFixtureIds.push(notification.fixtureId);
        }
        succeededProviderIds.push(fixture.providerId);
        processed += 1;

        // A no-op until the lease is half spent, then one round trip to extend
        // it. False means somebody else took the lease over after it expired,
        // and this run must stop writing rather than race them.
        if (!(await renewSyncLockIfNeeded(supabase, lock))) lostLease = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logError("football.sync.fixture", err, { detail: `Football sync: failed to sync fixture ${fixture.provider}:${fixture.providerId}` });
        errors.push(
          `${fixture.provider}:${fixture.providerId} (${fixture.homeTeam.name} v ${fixture.awayTeam.name}): ${message}`,
        );
        entityFailures.push({
          providerEntityId: fixture.providerId,
          message,
          // PostgrestError carries a SQLSTATE on `code`; a thrown Error does
          // not. Read it structurally rather than parsing the message.
          code: typeof err === "object" && err !== null && "code" in err ? String(err.code) : null,
          label: `${fixture.homeTeam.name} v ${fixture.awayTeam.name}`,
        });
      }
    });

    // KN-81: close failures for entities a later run genuinely succeeded on,
    // and open a row for each one that failed this time. Both are single
    // statements for the whole run, not a write per entity.
    await Promise.all([
      resolveEntityFailures(supabase, {
        provider: provider.name,
        entityType: "fixture",
        providerEntityIds: succeededProviderIds,
      }),
      recordEntityFailures(supabase, {
        syncRunId: syncRun.id,
        provider: provider.name,
        entityType: "fixture",
        failures: entityFailures,
      }),
      markFixturesSeen(supabase, seenFixtureIds),
    ]);

    /**
     * KN-86. Nothing ever noticed a fixture the provider stopped reporting: a
     * postponed-then-rescheduled match kept its last-known status on /matches
     * indefinitely. This flags them for admin review — and only flags, because
     * absence from one response is a question, not a verdict, and an
     * auto-delete here would destroy real rows on a provider hiccup.
     *
     * Three conditions before it runs at all, each removing a class of false
     * positive rather than tuning a threshold:
     *   - the run must have processed something. A run that returned nothing
     *     is evidence about the provider, not about any individual fixture.
     *   - the run must not have lost its lease, or "absent" would really mean
     *     "this run stopped early".
     *   - the window is only the UTC day this run actually asked about
     *     (`todayIsoDate`), never a fixture the run never looked for.
     *
     * The SQL adds the rest (previously-seen only, pre-final statuses only,
     * this provider's mappings only) — see `flag_absent_fixtures` in migration
     * 0056. One known and accepted limitation: if
     * FOOTBALL_SYNC_COMPETITION_IDS is narrowed after fixtures were already
     * synced, the now-unscoped ones stop being reported and will be flagged.
     * That is arguably correct — KIVO really has stopped receiving updates for
     * them — and it is a flag for a human, not an automatic change.
     */
    /**
     * A live run NEVER flags absences, and this is not a tuning decision.
     *
     * `/fixtures?live=all` returns only what is in play. Absence from it means
     * "not currently in play" — which is true of almost every fixture on any
     * given day, including every one that has not kicked off and every one that
     * finished an hour ago. Running the absence check against that response
     * would flag the entire day's football as missing from the provider, on
     * every single live poll. The check is sound; the premise it depends on
     * (the run asked about all of these fixtures) is only true of a dated run.
     */
    if (source === "live") {
      // Nothing to do. Stated as a branch rather than folded into the condition
      // below so the reason is readable at the point of the decision.
    } else if (processed > 0 && !lostLease) {
      // Scoped to the day this run actually asked for, not to "today" — a
      // backfill of last Saturday must not flag today's fixtures as absent
      // just because the provider never mentioned them in a query about
      // Saturday.
      const dayStart = new Date(`${targetDate}T00:00:00.000Z`);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const flagged = await flagAbsentFixtures(supabase, {
        provider: provider.name,
        runStartedAt: runStartedAt,
        kickoffFrom: dayStart.toISOString(),
        kickoffTo: dayEnd.toISOString(),
      });
      if (flagged > 0) {
        console.warn(`Football sync: flagged ${flagged} fixture(s) the provider stopped reporting today`);
      }
    }

    const hadFixtures = fixtures.length > 0;
    const dbStatus: Database["public"]["Enums"]["sync_status"] =
      lostLease
        ? "partial"
        : errors.length === 0
          ? "success"
          : hadFixtures && processed === 0
            ? "failed"
            : "partial";
    // Keep this bounded — a bad day shouldn't write an unbounded error_message blob.
    // The full, untruncated list now lives in sync_run_failures (KN-81); this
    // stays the skimmable summary it always was.
    const errorMessage = lostLease
      ? "Stopped early: this run's sync lock was taken over by another run after its lease expired."
      : errors.length > 0
        ? errors.slice(0, 20).join("; ")
        : // A run the allowlist emptied is NOT a quiet day with no football, and
          // reporting it as one is the exact confusion the founder already hit
          // once ("Stop reporting a refused provider request as a quiet day with
          // no football"). The provider had matches; KIVO chose not to write
          // them. That is a configuration fact and it belongs on the run, or
          // the only visible symptom is a sync that succeeds and writes
          // nothing, forever, with no way to tell why.
          !hadFixtures && scopedOutCount > 0
          ? `The competition allowlist scoped out all ${fixturesBeforeScoping} of the provider's fixtures for this day — none of them were in the configured competitions. This is a scope decision, not an absence of football. See FOOTBALL_SYNC_COMPETITION_IDS.`
          : null;

    await finalizeRun({
      status: dbStatus,
      last_synced_at: new Date().toISOString(),
      records_processed: processed,
      // KN-88: null would have been indistinguishable from "no failures", so
      // this is written on every terminal path that actually counted.
      records_failed: entityFailures.length,
      error_message: errorMessage,
    });

    result = {
      status: dbStatus === "failed" ? "failed" : "succeeded",
      recordsProcessed: processed,
      error: errorMessage ?? undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("football.sync.runReachingTerminalState", err);
    await finalizeRun({ status: "failed", records_processed: processed, error_message: message });
    return { status: "failed", recordsProcessed: processed, error: message };
  } finally {
    // Only reachable if both paths above somehow failed to finalize (e.g. the
    // catch block's own update threw). Never leave the row `running`.
    await finalizeRun({
      status: "failed",
      records_processed: processed,
      error_message: "Sync ended without recording a terminal status.",
    });
    // KN-82: released here rather than on the success path, so a crash, a
    // throw, or a returned failure all free the lease immediately instead of
    // making the next run wait out the full lease. The lease's own expiry
    // remains the backstop for the one case this cannot cover — the process
    // being killed outright.
    await releaseSyncLock(supabase, lock);
  }

  // Deliberately after the run row is terminal — see dispatchStatusNotifications.
  await dispatchStatusNotifications(supabase, pendingNotifications);

  return result;
}
