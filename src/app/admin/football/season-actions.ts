"use server";

import { revalidatePath } from "next/cache";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getActiveProviderStatus } from "@/lib/football";
import { currentProviderSeason } from "@/lib/football/target-season";
import { logError } from "@/lib/log";

/**
 * Pointing KIVO at a season the plan can actually see.
 *
 * ## Why this button exists
 *
 * The live database recorded the provider's own refusal: "Free plans do not
 * have access to this season, try from 2022 to 2024." KIVO was asking for 2026,
 * because it derived the season from the calendar and had no way to be told
 * otherwise. Every season-scoped endpoint — the coverage registry, the club
 * lists, standings, injuries, top scorers, player season statistics — was
 * refused, and every one of those refusals rendered as an empty table.
 *
 * Before this, changing it meant an engineer, a commit and a deploy. Now it is
 * a number in a box, and the day the plan is upgraded it is the same number in
 * the same box going back.
 *
 * ## Why it will not accept just any number
 *
 * A season year that is not a plausible year is refused rather than written.
 * A wrong season does not fail loudly — it syncs nothing and looks exactly like
 * a quiet week, which is the same class of silent-wrong-value mistake
 * `competition_scope` was built to end for league ids.
 *
 * ## Why clearing it is a separate action
 *
 * Reverting to the calendar season is the thing an operator does the moment
 * they upgrade the plan, and it must not require guessing which year to type.
 */

async function requireAdmin(): Promise<{ error: string } | null> {
  const profile = await getOrCreateProfile();
  if (!profile || !canManageFootballData(profile.role)) {
    return { error: "You don't have football data admin access." };
  }
  return null;
}

export type TargetSeasonResult = { error: string | null; seasonYear?: number };

/** Widest plausible range for a season's starting year. Matches the CHECK
 * constraint in migration 0115 — the database is the enforcement, this is the
 * message. */
const MIN_SEASON_YEAR = 1888;
const MAX_SEASON_YEAR = 2100;

export async function setTargetSeason(seasonYear: number, reason: string): Promise<TargetSeasonResult> {
  const denied = await requireAdmin();
  if (denied) return denied;

  if (!Number.isInteger(seasonYear) || seasonYear < MIN_SEASON_YEAR || seasonYear > MAX_SEASON_YEAR) {
    return {
      error: `"${seasonYear}" is not a season year. Enter the season's STARTING year — 2024 means the 2024/25 season.`,
    };
  }

  const { name: providerName } = getActiveProviderStatus();
  if (!providerName) return { error: "No football data provider is configured." };

  const profile = await getOrCreateProfile();
  const supabase = createServiceRoleSupabaseClient();

  const trimmedReason = reason.trim();
  const { error } = await supabase.from("provider_season_target").upsert(
    {
      provider: providerName,
      season_year: seasonYear,
      // Empty means "no reason given" rather than an empty string, so the panel
      // can tell the two apart and not render a blank line.
      reason: trimmedReason.length > 0 ? trimmedReason.slice(0, 500) : null,
      set_by: profile?.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider" },
  );

  if (error) {
    logError("admin.setTargetSeason", error, { provider: providerName, seasonYear });
    return { error: "Couldn't save the target season." };
  }

  // Every surface that renders synced football changes meaning when this
  // changes, so every one of them is invalidated — a standings table cached
  // under the old season would otherwise keep claiming to be the new one.
  revalidatePath("/admin/football", "layout");
  revalidatePath("/leagues");
  revalidatePath("/matches");
  revalidatePath("/teams");
  revalidatePath("/players");
  return { error: null, seasonYear };
}

/** Back to the calendar season. The action for the day the plan is upgraded. */
export async function clearTargetSeason(): Promise<TargetSeasonResult> {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { name: providerName } = getActiveProviderStatus();
  if (!providerName) return { error: "No football data provider is configured." };

  const supabase = createServiceRoleSupabaseClient();
  const { error } = await supabase.from("provider_season_target").delete().eq("provider", providerName);

  if (error) {
    logError("admin.clearTargetSeason", error, { provider: providerName });
    return { error: "Couldn't clear the target season." };
  }

  revalidatePath("/admin/football", "layout");
  revalidatePath("/leagues");
  revalidatePath("/matches");
  revalidatePath("/teams");
  revalidatePath("/players");
  return { error: null, seasonYear: currentProviderSeason() };
}
