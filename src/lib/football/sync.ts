import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";
import { getFootballDataProvider } from "./index";
import type { FixtureStatus, NormalizedFixture, NormalizedTeam } from "./types";
import { notifyFixtureStatusChange } from "./match-notifications";
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
): Promise<void> {
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

  // RECOMMENDATIONS.md notification items: kickoff/full-time. Fires off the
  // exact status write this function just made, using the real KIVO fixture
  // id the RPC itself returns (not the provider id) — see
  // notifyFixtureStatusChange's own doc comment for why `previousStatus`
  // (looked up once per whole run, see syncTodayFixtures) has to be known
  // and different from the new status before this does anything.
  if (kivoFixtureId) {
    await notifyFixtureStatusChange(supabase, {
      fixtureId: kivoFixtureId,
      homeTeamId: refs.homeTeamId,
      awayTeamId: refs.awayTeamId,
      homeTeamName: fixture.homeTeam.name,
      awayTeamName: fixture.awayTeam.name,
      previousStatus,
      newStatus: toDbFixtureStatus(fixture.status),
      homeScore: fixture.homeScore,
      awayScore: fixture.awayScore,
    });
  }
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * On-demand, admin-triggered sync of today's fixtures — see FOOTBALL_LIVE_POLLING_ENABLED
 * in ./index.ts for why this is never called on a timer/loop of any kind. Single call to
 * getFixturesByDate() per run (quota-conscious), writes go through the service-role client
 * per the schema's RLS design (see supabase/migrations/0001, "a future sync job should use
 * the service_role key"). A bad fixture never aborts the whole batch; every fixture-level
 * failure is caught, logged and rolled into the run's error_message instead.
 *
 * Competition/team/venue provider_mappings lookups are batched once up front across the
 * whole fixtures array (RECOMMENDATIONS.md item 27) rather than re-queried per fixture —
 * an unfiltered day can be hundreds of fixtures, and this turns the ~6 sequential round
 * trips per fixture that used to invite a server-action timeout into 3 batch lookups plus
 * per-fixture work that's now limited to season/fixture resolution and inserts for
 * whatever competitions/teams/venues actually turned out to be new.
 */
export async function syncTodayFixtures(): Promise<SyncResult> {
  const supabase = createServiceRoleSupabaseClient();
  const provider = await getFootballDataProvider();

  const { data: syncRun, error: startError } = await supabase
    .from("sync_runs")
    .insert({ provider: provider.name, entity_type: "fixture", status: "running" })
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

  let fixtures: NormalizedFixture[];
  try {
    fixtures = await provider.getFixturesByDate(todayIsoDate());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Football sync: getFixturesByDate failed", err);
    await supabase
      .from("sync_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        records_processed: 0,
        error_message: message,
        // RECOMMENDATIONS.md item 53: real quota data even on a hard failure —
        // a rate-limited or otherwise non-OK response still updates this via
        // ApiFootballError.quotaRemaining (see api-football-request.ts).
        provider_quota_remaining: provider.getQuotaRemaining(),
        // RECOMMENDATIONS.md item 65: the raw response sample is most
        // valuable on exactly this path — a hard getFixturesByDate failure
        // is the case an admin most needs to see what the provider actually
        // sent back.
        raw_response_sample: provider.getLastRawResponseSample() as Json | null,
      })
      .eq("id", syncRun.id);
    return { status: "failed", recordsProcessed: 0, error: message };
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
  const knownKivoFixtureIds = Array.from(fixtureMappings.values());
  if (knownKivoFixtureIds.length > 0) {
    const { data: priorRows, error: priorError } = await supabase
      .from("fixtures")
      .select("id, status")
      .in("id", knownKivoFixtureIds);
    if (priorError) throw priorError;
    for (const row of priorRows ?? []) priorStatusByKivoId.set(row.id, row.status);
  }

  let processed = 0;
  const errors: string[] = [];

  for (const fixture of fixtures) {
    try {
      const competitionId = await upsertCompetition(
        supabase,
        provider.name,
        fixture.competitionProviderId,
        fixture.competitionName,
        competitionMappings,
      );
      const seasonId = await upsertSeason(supabase, competitionId, fixture.season);
      const homeTeamId = await upsertTeam(supabase, provider.name, fixture.homeTeam, teamMappings);
      const awayTeamId = await upsertTeam(supabase, provider.name, fixture.awayTeam, teamMappings);
      const venueId = fixture.venueProviderId
        ? await upsertVenue(supabase, provider.name, fixture.venueProviderId, fixture.venueName, venueMappings)
        : null;

      const knownKivoId = fixtureMappings.get(fixture.providerId) ?? null;
      const previousStatus = knownKivoId ? (priorStatusByKivoId.get(knownKivoId) ?? null) : null;

      await upsertFixture(
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
      );
      processed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Football sync: failed to sync fixture ${fixture.provider}:${fixture.providerId}`, err);
      errors.push(`${fixture.provider}:${fixture.providerId} (${fixture.homeTeam.name} v ${fixture.awayTeam.name}): ${message}`);
    }
  }

  const finishedAt = new Date().toISOString();
  const hadFixtures = fixtures.length > 0;
  const dbStatus: Database["public"]["Enums"]["sync_status"] =
    errors.length === 0 ? "success" : hadFixtures && processed === 0 ? "failed" : "partial";
  // Keep this bounded — a bad day shouldn't write an unbounded error_message blob.
  const errorMessage = errors.length > 0 ? errors.slice(0, 20).join("; ") : null;

  await supabase
    .from("sync_runs")
    .update({
      status: dbStatus,
      finished_at: finishedAt,
      last_synced_at: finishedAt,
      records_processed: processed,
      error_message: errorMessage,
      // RECOMMENDATIONS.md item 53: the provider's own remaining-quota count,
      // not an estimate — see ApiFootballProvider.getQuotaRemaining().
      provider_quota_remaining: provider.getQuotaRemaining(),
      // RECOMMENDATIONS.md item 65: written on every finish, not only a hard
      // failure, so an admin can inspect "what did the provider actually
      // send back" on request for a run that otherwise succeeded.
      raw_response_sample: provider.getLastRawResponseSample() as Json | null,
    })
    .eq("id", syncRun.id);

  return {
    status: dbStatus === "failed" ? "failed" : "succeeded",
    recordsProcessed: processed,
    error: errorMessage ?? undefined,
  };
}
