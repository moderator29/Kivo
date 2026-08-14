import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { getFootballDataProvider } from "./index";
import type { FixtureStatus, NormalizedFixture, NormalizedTeam } from "./types";

type ServiceClient = SupabaseClient<Database>;
type EntityType = Database["public"]["Enums"]["provider_entity_type"];
type DbFixtureStatus = Database["public"]["Enums"]["fixture_status"];

export interface SyncResult {
  status: "succeeded" | "failed";
  recordsProcessed: number;
  error?: string;
}

/** "unknown" exists only at the normalization layer (see types.ts) — the DB's
 * fixture_status enum has no matching value. "postponed" is the closest honest
 * reading of a provider status we couldn't otherwise classify (e.g. TBD/SUSP/INT). */
function toDbFixtureStatus(status: FixtureStatus): DbFixtureStatus {
  return status === "unknown" ? "postponed" : status;
}

async function findMappedId(
  supabase: ServiceClient,
  provider: string,
  entityType: EntityType,
  providerEntityId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("provider_mappings")
    .select("kivo_entity_id")
    .eq("provider", provider)
    .eq("entity_type", entityType)
    .eq("provider_entity_id", providerEntityId)
    .maybeSingle();

  if (error) throw error;
  return data?.kivo_entity_id ?? null;
}

async function createMapping(
  supabase: ServiceClient,
  provider: string,
  entityType: EntityType,
  providerEntityId: string,
  kivoEntityId: string,
): Promise<void> {
  const { error } = await supabase
    .from("provider_mappings")
    .insert({ provider, entity_type: entityType, provider_entity_id: providerEntityId, kivo_entity_id: kivoEntityId });
  // 23505 = another concurrent sync already created this mapping — fine, it points
  // at the same kivo entity either way.
  if (error && error.code !== "23505") throw error;
}

async function upsertCompetition(
  supabase: ServiceClient,
  provider: string,
  competitionProviderId: string,
  name: string,
): Promise<string> {
  const existing = await findMappedId(supabase, provider, "competition", competitionProviderId);
  if (existing) return existing;

  const { data, error } = await supabase.from("competitions").insert({ name }).select("id").single();
  if (error || !data) throw error ?? new Error("Failed to insert competition");

  await createMapping(supabase, provider, "competition", competitionProviderId, data.id);
  return data.id;
}

/** Seasons aren't provider-mapped (the provider only reports a bare year, no
 * stable season id) — deduped instead on the table's own (competition_id, name)
 * unique constraint, same race-safe select/insert/re-select shape as profile.ts.
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
  const name = String(seasonYear);

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
      .insert({ competition_id: competitionId, name })
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

async function upsertVenue(
  supabase: ServiceClient,
  provider: string,
  venueProviderId: string,
  name: string | null,
): Promise<string> {
  const existing = await findMappedId(supabase, provider, "venue", venueProviderId);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("venues")
    .insert({ name: name ?? "Unknown venue" })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Failed to insert venue");

  await createMapping(supabase, provider, "venue", venueProviderId, data.id);
  return data.id;
}

async function upsertTeam(supabase: ServiceClient, provider: string, team: NormalizedTeam): Promise<string> {
  const existing = await findMappedId(supabase, provider, "team", team.providerId);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("teams")
    .insert({ name: team.name, short_name: team.shortName, crest_url: team.crestUrl })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Failed to insert team");

  await createMapping(supabase, provider, "team", team.providerId, data.id);
  return data.id;
}

interface ResolvedFixtureRefs {
  competitionId: string;
  seasonId: string;
  homeTeamId: string;
  awayTeamId: string;
  venueId: string | null;
}

async function upsertFixture(
  supabase: ServiceClient,
  provider: string,
  fixture: NormalizedFixture,
  refs: ResolvedFixtureRefs,
): Promise<void> {
  const payload = {
    competition_id: refs.competitionId,
    season_id: refs.seasonId,
    home_team_id: refs.homeTeamId,
    away_team_id: refs.awayTeamId,
    venue_id: refs.venueId,
    status: toDbFixtureStatus(fixture.status),
    kickoff_at: fixture.kickoffAt,
    home_score: fixture.homeScore,
    away_score: fixture.awayScore,
  };

  const existingId = await findMappedId(supabase, provider, "fixture", fixture.providerId);

  if (existingId) {
    const { error } = await supabase.from("fixtures").update(payload).eq("id", existingId);
    if (error) throw error;
    return;
  }

  const { data, error } = await supabase.from("fixtures").insert(payload).select("id").single();
  if (error || !data) throw error ?? new Error("Failed to insert fixture");

  await createMapping(supabase, provider, "fixture", fixture.providerId, data.id);
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
 */
export async function syncTodayFixtures(): Promise<SyncResult> {
  const supabase = createServiceRoleSupabaseClient();
  const provider = getFootballDataProvider();

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
      })
      .eq("id", syncRun.id);
    return { status: "failed", recordsProcessed: 0, error: message };
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
      );
      const seasonId = await upsertSeason(supabase, competitionId, fixture.season);
      const homeTeamId = await upsertTeam(supabase, provider.name, fixture.homeTeam);
      const awayTeamId = await upsertTeam(supabase, provider.name, fixture.awayTeam);
      const venueId = fixture.venueProviderId
        ? await upsertVenue(supabase, provider.name, fixture.venueProviderId, fixture.venueName)
        : null;

      await upsertFixture(supabase, provider.name, fixture, {
        competitionId,
        seasonId,
        homeTeamId,
        awayTeamId,
        venueId,
      });
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
    })
    .eq("id", syncRun.id);

  return {
    status: dbStatus === "failed" ? "failed" : "succeeded",
    recordsProcessed: processed,
    error: errorMessage ?? undefined,
  };
}
