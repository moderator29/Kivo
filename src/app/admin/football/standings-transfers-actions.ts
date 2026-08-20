"use server";

import { revalidatePath } from "next/cache";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getFootballDataProvider } from "@/lib/football";
import { reserveProviderRequests } from "@/lib/football/request-budget";
import { syncScopedStandings, type ScopedStandingsResult } from "@/lib/football/sync-standings-scope";
import { syncTeamTransfers } from "@/lib/football/sync-transfers";

/**
 * The two admin triggers for the surfaces the founder found empty: league
 * tables and transfers.
 *
 * Neither was broken. Both were unreachable — `syncStandings` had never once
 * been called (zero `sync_runs` rows with `entity_type = 'standing'`), and
 * transfer history was per-player at one request each, which no operator was
 * ever going to press twenty-five times for one club. See the doc comments on
 * `syncScopedStandings` and `syncTeamTransfers` for the full diagnosis.
 *
 * Its own file, following the convention `catalogue-actions.ts` sets out:
 * several agents edit this directory at once, and new exports appended to a hot
 * file is how a merge quietly drops one.
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

/**
 * Refreshes league tables for the competitions KIVO is configured to cover, in
 * the operator's own configured order.
 *
 * **Costs up to 5 provider requests**, one per table, reserved from the `daily`
 * bucket — the same allowance the 05:00 cron's standings pass draws on, because
 * this is that job done early rather than a second one competing with it.
 */
export async function triggerScopedStandingsSync(): Promise<ScopedStandingsResult> {
  const denied = await requireFootballDataAccess();
  if (denied) return { error: denied.error, outcomes: [], requestsSpent: 0 };

  const result = await syncScopedStandings();

  revalidatePath("/admin/football", "layout");
  // Every league page that just got a table, plus the standings tab inside
  // every Match Centre for those competitions — which is the surface a fan
  // actually notices. Only the competitions that really changed.
  for (const outcome of result.outcomes) {
    if (outcome.status === "synced") revalidatePath(`/leagues/${outcome.competitionId}`);
  }

  return result;
}

export type TeamTransfersSyncResult = {
  error: string | null;
  teamName: string | null;
  recordsProcessed: number;
};

/**
 * One club's whole recorded transfer history.
 *
 * **Costs 1 provider request**, whatever the size of the history, reserved from
 * the `catalogue` bucket — this is catalogue work in the same sense the club and
 * squad backfills are: it fills in a club KIVO already knows about, and it goes
 * quiet once done.
 */
export async function triggerTeamTransfersSync(teamId: string): Promise<TeamTransfersSyncResult> {
  const denied = await requireFootballDataAccess();
  if (denied) return { error: denied.error, teamName: null, recordsProcessed: 0 };

  const supabase = createServiceRoleSupabaseClient();
  const provider = await getFootballDataProvider();

  const { data: team } = await supabase.from("teams").select("name").eq("id", teamId).maybeSingle();
  const teamName = team?.name ?? null;

  // Reserved before the request, never after: an allowance that is only
  // decremented on success is not an allowance, it is a suggestion.
  const decision = await reserveProviderRequests(supabase, provider.name, "catalogue", 1);
  if (!decision.allowed) {
    return {
      error: "The catalogue allowance for today is spent. Try again after it rolls over.",
      teamName,
      recordsProcessed: 0,
    };
  }

  const result = await syncTeamTransfers(teamId);

  revalidatePath("/admin/football", "layout");
  revalidatePath("/transfers");
  revalidatePath(`/teams/${teamId}`);

  if (result.status === "failed") {
    return {
      error: result.error ?? "Transfer sync failed. See the sync_runs row for details.",
      teamName,
      recordsProcessed: 0,
    };
  }

  return { error: null, teamName, recordsProcessed: result.recordsProcessed };
}
