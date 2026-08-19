"use server";

import { revalidatePath } from "next/cache";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import {
  adoptAllowlistedCompetitions,
  backfillCompetitionCountries,
  backfillSquads,
  syncCompetitionTeams,
  type AdoptedCompetition,
  type SquadBackfillResult,
} from "@/lib/football/sync-catalogue";

/**
 * The club catalogue's admin triggers.
 *
 * A separate file from `actions.ts` and `provider-data-actions.ts` for the same
 * reason the latter exists: several agents edit this directory concurrently, and
 * new exports appended to a hot file is how a merge quietly drops one.
 *
 * ## Every action here states its cost before it is pressed
 *
 * The component that renders these buttons prints the number of provider
 * requests each one will spend, and the numbers are not decorative — they come
 * from the same constants the sync itself reserves against. Two of the four
 * actions cost NOTHING (they read a registry KIVO already bought), and saying so
 * plainly is as important as warning about the ones that do: an operator who
 * believes every button is expensive will not press the free ones, and the free
 * ones are the ones that have to run first.
 */

async function requireFootballDataAccess(): Promise<{ error: string } | null> {
  const profile = await getOrCreateProfile();
  if (!profile || !canManageFootballData(profile.role)) {
    return { error: "You don't have football data admin access." };
  }
  if (!process.env.API_FOOTBALL_KEY) {
    return { error: "No real football data provider is configured. Set API_FOOTBALL_KEY before syncing." };
  }
  return null;
}

/** Admin check only — for the two actions that make no provider calls at all
 * and therefore have no reason to demand a provider key. */
async function requireAdmin(): Promise<{ error: string } | null> {
  const profile = await getOrCreateProfile();
  if (!profile || !canManageFootballData(profile.role)) {
    return { error: "You don't have football data admin access." };
  }
  return null;
}

export type AdoptCompetitionsResult = { error: string | null; competitions: AdoptedCompetition[] };

/**
 * Creates a `competitions` row for every id in the effective allowlist, named
 * and located from the coverage registry.
 *
 * **Costs 0 provider requests.** Everything it needs was bought by the coverage
 * sync's single `/leagues` call. Run that first; this is useless without it and
 * says so rather than pretending.
 *
 * This is the step that puts La Liga in the database on a day nobody in La Liga
 * played — which is the whole defect.
 */
export async function adoptCompetitions(): Promise<AdoptCompetitionsResult> {
  const denied = await requireAdmin();
  if (denied) return { error: denied.error, competitions: [] };

  const result = await adoptAllowlistedCompetitions();

  revalidatePath("/admin/data-health");
  revalidatePath("/leagues");
  return result;
}

/**
 * Fills `competitions.country` from the coverage registry for every competition
 * already on file that has none.
 *
 * **Costs 0 provider requests.** Repairs the live database's most visible
 * symptom: 85 competitions with a null country, rendered by the leagues UI as
 * "International".
 */
export async function fillCompetitionCountries(): Promise<{ error: string | null; recordsProcessed?: number }> {
  const denied = await requireAdmin();
  if (denied) return denied;

  const result = await backfillCompetitionCountries();

  revalidatePath("/admin/data-health");
  revalidatePath("/leagues");
  revalidatePath("/teams");
  return result;
}

/**
 * Every club in one competition, for the current provider season.
 *
 * **Costs exactly 1 provider request**, whatever the size of the league, and it
 * is reserved from the `catalogue` allowance before the call is made. A
 * twenty-club league and a two-club one cost the same.
 */
export async function syncCompetitionClubs(
  competitionId: string,
  season?: number,
): Promise<{ error: string | null; recordsProcessed?: number; requestsSpent?: number }> {
  const denied = await requireFootballDataAccess();
  if (denied) return denied;

  const result = await syncCompetitionTeams(competitionId, season);

  revalidatePath("/admin/data-health");
  revalidatePath("/teams");
  revalidatePath(`/leagues/${competitionId}`);

  if (result.status === "failed") {
    return {
      error: result.error ?? "Club sync failed. See the sync_runs row for details.",
      requestsSpent: result.requestsSpent,
    };
  }
  return { error: null, recordsProcessed: result.recordsProcessed, requestsSpent: result.requestsSpent };
}

/**
 * One bounded batch of squads.
 *
 * **Costs up to 2 provider requests per club** (the squad and the manager are
 * separate endpoints), for at most `SQUAD_BATCH_MAX_REQUESTS` clubs, and the
 * exact number is reserved before the first call. If the allowance only permits
 * fewer clubs than asked for, fewer clubs are done — never more, and never a
 * silent overspend.
 *
 * Resumable by construction: the next press starts where this one stopped.
 */
export async function runSquadBackfill(maxClubs?: number): Promise<SquadBackfillResult> {
  const denied = await requireFootballDataAccess();
  if (denied) {
    return {
      error: denied.error,
      clubsSynced: 0,
      playersProcessed: 0,
      requestsSpent: 0,
      failures: [],
      budget: null,
      moreRemaining: false,
    };
  }

  const result = await backfillSquads(maxClubs);

  revalidatePath("/admin/data-health");
  revalidatePath("/players");
  revalidatePath("/teams");
  return result;
}
