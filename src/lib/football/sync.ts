import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";
import { getFootballDataProvider } from "./index";
import type { FixtureStatus, NormalizedFixture, NormalizedTeam } from "./types";
import { notifyFixtureStatusChange, type FixtureStatusChangeInput } from "./match-notifications";
import { createAsyncMemo, createKeyedSerializer, mapWithConcurrency } from "@/lib/concurrency";
import { getSyncedCompetitionProviderIds } from "./competitions-config";

type ServiceClient = SupabaseClient<Database>;
type EntityType = Database["public"]["Enums"]["provider_entity_type"];
type DbFixtureStatus = Database["public"]["Enums"]["fixture_status"];

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

/**
 * RECOMMENDATIONS.md item 27: one `provider_mappings` round trip for every distinct
 * provider id of a given entity type, instead of one round trip per fixture. Called
 * once up front per entity type (competition/team/venue) with every distinct id the
 * whole day's fixture batch references; the returned map is then threaded through
 * upsertCompetition/upsertTeam/upsertVenue below as their existence check, and each
 * of those mutates it in place when it inserts a brand-new row so a later fixture in
 * the same run that references the same provider id reuses it instead of inserting
 * again. Empty input skips the request entirely — a day with e.g. no venue ids at
 * all shouldn't fire an empty `.in()` query.
 */
async function batchFindMappedIds(
  supabase: ServiceClient,
  provider: string,
  entityType: EntityType,
  providerEntityIds: string[],
): Promise<Map<string, string>> {
  const known = new Map<string, string>();
  if (providerEntityIds.length === 0) return known;

  const { data, error } = await supabase
    .from("provider_mappings")
    .select("provider_entity_id, kivo_entity_id")
    .eq("provider", provider)
    .eq("entity_type", entityType)
    .in("provider_entity_id", providerEntityIds);

  if (error) throw error;
  for (const row of data ?? []) known.set(row.provider_entity_id, row.kivo_entity_id);
  return known;
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
  knownMappings: Map<string, string>,
): Promise<string> {
  const existing = knownMappings.get(competitionProviderId) ?? null;
  if (existing) {
    const { error } = await supabase.from("competitions").update({ name }).eq("id", existing);
    if (error) throw error;
    return existing;
  }

  const { data, error } = await supabase.rpc("upsert_competition_with_mapping", {
    p_provider: provider,
    p_provider_entity_id: competitionProviderId,
    p_name: name,
  });
  if (error || !data) throw error ?? new Error("upsert_competition_with_mapping returned no id");

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
  knownMappings: Map<string, string>,
): Promise<string> {
  const existing = knownMappings.get(venueProviderId) ?? null;
  if (existing) {
    if (name !== null) {
      const { error } = await supabase.from("venues").update({ name }).eq("id", existing);
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
): Promise<FixtureStatusChangeInput | null> {
  // RECOMMENDATIONS.md item 303 ("conflict detection"): a same-provider
  // sanity check, not a second-provider merge (there's no second source to
  // reconcile against yet — see DECISIONS.md's provider-failover entry).
  // Flags, never blocks: the write below still lands either way, since a
  // false positive here (e.g. a legitimate admin correction) shouldn't drop
  // real provider data. This only makes an anomaly visible in server logs
  // (item 204's existing "every failure path is console.error" convention)
  // instead of it landing silently.
  if (previousScores) {
    if (
      fixture.homeScore !== null &&
      previousScores.homeScore !== null &&
      fixture.homeScore < previousScores.homeScore
    ) {
      console.warn(
        `Football sync anomaly: ${provider}:${fixture.providerId} home score decreased ${previousScores.homeScore} -> ${fixture.homeScore} (${fixture.homeTeam.name} v ${fixture.awayTeam.name})`,
      );
    }
    if (
      fixture.awayScore !== null &&
      previousScores.awayScore !== null &&
      fixture.awayScore < previousScores.awayScore
    ) {
      console.warn(
        `Football sync anomaly: ${provider}:${fixture.providerId} away score decreased ${previousScores.awayScore} -> ${fixture.awayScore} (${fixture.homeTeam.name} v ${fixture.awayTeam.name})`,
      );
    }
  }
  if (previousStatus === "finished" && toDbFixtureStatus(fixture.status) !== "finished") {
    console.warn(
      `Football sync anomaly: ${provider}:${fixture.providerId} status regressed from finished to ${fixture.status} (${fixture.homeTeam.name} v ${fixture.awayTeam.name})`,
    );
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

  const { data: kivoFixtureId, error } = await supabase.rpc("upsert_fixture_with_mapping", args);
  if (error) throw error;

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

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
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
      console.error(`Football sync: notification fan-out failed for fixture ${input.fixtureId}`, err);
    }
  });
}

export async function syncTodayFixtures(triggerSource: "manual" | "cron" = "manual"): Promise<SyncResult> {
  const supabase = createServiceRoleSupabaseClient();
  const provider = await getFootballDataProvider();

  const { data: syncRun, error: startError } = await supabase
    .from("sync_runs")
    .insert({ provider: provider.name, entity_type: "fixture", status: "running", trigger_source: triggerSource })
    .select("id")
    .single();

  if (startError || !syncRun) {
    console.error("Failed to start football sync run", startError);
    return {
      status: "failed",
      recordsProcessed: 0,
      error: startError?.message ?? "Could not create sync_runs row",
    };
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
    if (error) console.error("Football sync: failed to write terminal sync_runs status", error);
  };

  const pendingNotifications: FixtureStatusChangeInput[] = [];
  let result: SyncResult;

  try {
    let fixtures: NormalizedFixture[];
    try {
      fixtures = await provider.getFixturesByDate(todayIsoDate());
    } catch (err) {
      console.error("Football sync: getFixturesByDate failed", err);
      throw err;
    }

    // RECOMMENDATIONS.md item 28: scope the whole run to configured
    // competitions, if any are configured — see competitions-config.ts for why
    // this filters the already-fetched response rather than issuing one
    // provider request per league, and why "unset" means "no filter" rather
    // than a KIVO-invented default league list. Filtering here, before any of
    // the mapping/upsert work below, is what keeps competitions/teams/venues
    // outside the configured set from ever being written at all — not just
    // hidden from the UI afterwards.
    const syncedCompetitionIds = getSyncedCompetitionProviderIds();
    const fixturesBeforeScoping = fixtures.length;
    if (syncedCompetitionIds) {
      fixtures = fixtures.filter((f) => syncedCompetitionIds.has(f.competitionProviderId));
    }
    const scopedOutCount = fixturesBeforeScoping - fixtures.length;
    if (scopedOutCount > 0) {
      console.info(
        `Football sync: scoped out ${scopedOutCount}/${fixturesBeforeScoping} fixtures outside FOOTBALL_SYNC_COMPETITION_IDS`,
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

    const errors: string[] = [];
    const resolveSeason = createSeasonResolver(supabase);

    await mapWithConcurrency(fixtures, FIXTURE_WRITE_CONCURRENCY, async (fixture) => {
      try {
        const competitionId = await upsertCompetition(
          supabase,
          provider.name,
          fixture.competitionProviderId,
          fixture.competitionName,
          competitionMappings,
        );
        const seasonId = await resolveSeason(competitionId, fixture.season);
        const [homeTeamId, awayTeamId, venueId] = await Promise.all([
          upsertTeam(supabase, provider.name, fixture.homeTeam, teamMappings),
          upsertTeam(supabase, provider.name, fixture.awayTeam, teamMappings),
          fixture.venueProviderId
            ? upsertVenue(supabase, provider.name, fixture.venueProviderId, fixture.venueName, venueMappings)
            : Promise.resolve(null),
        ]);

        const knownKivoId = fixtureMappings.get(fixture.providerId) ?? null;
        const previousStatus = knownKivoId ? (priorStatusByKivoId.get(knownKivoId) ?? null) : null;
        const previousScores = knownKivoId ? (priorScoresByKivoId.get(knownKivoId) ?? null) : null;

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
        );
        if (notification) pendingNotifications.push(notification);
        processed += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Football sync: failed to sync fixture ${fixture.provider}:${fixture.providerId}`, err);
        errors.push(
          `${fixture.provider}:${fixture.providerId} (${fixture.homeTeam.name} v ${fixture.awayTeam.name}): ${message}`,
        );
      }
    });

    const hadFixtures = fixtures.length > 0;
    const dbStatus: Database["public"]["Enums"]["sync_status"] =
      errors.length === 0 ? "success" : hadFixtures && processed === 0 ? "failed" : "partial";
    // Keep this bounded — a bad day shouldn't write an unbounded error_message blob.
    const errorMessage = errors.length > 0 ? errors.slice(0, 20).join("; ") : null;

    await finalizeRun({
      status: dbStatus,
      last_synced_at: new Date().toISOString(),
      records_processed: processed,
      error_message: errorMessage,
    });

    result = {
      status: dbStatus === "failed" ? "failed" : "succeeded",
      recordsProcessed: processed,
      error: errorMessage ?? undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Football sync: run failed before reaching a terminal state", err);
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
  }

  // Deliberately after the run row is terminal — see dispatchStatusNotifications.
  await dispatchStatusNotifications(supabase, pendingNotifications);

  return result;
}
