"use server";

import { revalidatePath } from "next/cache";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { syncTodayFixtures } from "@/lib/football/sync";

export async function triggerFootballSync(): Promise<{ error: string | null; recordsProcessed?: number }> {
  const profile = await getOrCreateProfile();
  if (!profile || !canManageFootballData(profile.role)) {
    return { error: "You don't have football data admin access." };
  }

  // Mirrors the guard in getFootballDataProvider(): never let a "sync" silently run
  // against the dev-only mock provider and look like a real, production sync happened.
  if (!process.env.API_FOOTBALL_KEY) {
    return { error: "No real football data provider is configured — set API_FOOTBALL_KEY before syncing." };
  }

  const result = await syncTodayFixtures();

  revalidatePath("/admin/data-health");
  revalidatePath("/matches");

  if (result.status === "failed") {
    return { error: result.error ?? "Sync failed — see the sync_runs row for details." };
  }

  return { error: null, recordsProcessed: result.recordsProcessed };
}
