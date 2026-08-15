"use server";

import { revalidatePath } from "next/cache";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Derives fantasy_gameweeks rows from a season's real synced fixtures —
 * nothing invented, no cron. Grouped by the provider's own `matchday` when
 * every fixture in the season has one (the common case for league
 * competitions); falls back to bucketing by calendar week from the season's
 * first kickoff when `matchday` is null (e.g. cup competitions), renumbered
 * 1..N in chronological order. Each gameweek's deadline is the earliest
 * kickoff within its group, matching how submitPrediction-style deadline
 * enforcement already works elsewhere in this codebase. Existing gameweek
 * rows are never touched (an admin may have hand-adjusted a deadline), only
 * missing numbers are inserted.
 */
export async function generateFantasyGameweeks(
  seasonId: string,
): Promise<{ error: string | null; recordsProcessed?: number }> {
  const profile = await getOrCreateProfile();
  if (!profile || !canManageFootballData(profile.role)) {
    return { error: "You don't have football data admin access." };
  }

  const supabase = createServerSupabaseClient();
  const { data: fixtures, error: fixturesError } = await supabase
    .from("fixtures")
    .select("id, matchday, kickoff_at")
    .eq("season_id", seasonId)
    .order("kickoff_at", { ascending: true });

  if (fixturesError) {
    console.error("Failed to load fixtures for gameweek generation", fixturesError);
    return { error: "Couldn't load this season's fixtures. Try again." };
  }

  if (!fixtures || fixtures.length === 0) {
    return { error: "This season has no synced fixtures yet. Sync fixtures before generating gameweeks." };
  }

  const groups = new Map<number, { number: number; deadlineAt: string }>();

  const allHaveMatchday = fixtures.every((f) => f.matchday !== null);
  if (allHaveMatchday) {
    for (const f of fixtures) {
      const number = f.matchday as number;
      const existing = groups.get(number);
      if (!existing || f.kickoff_at < existing.deadlineAt) {
        groups.set(number, { number, deadlineAt: f.kickoff_at });
      }
    }
  } else {
    const seasonStartMs = new Date(fixtures[0].kickoff_at).getTime();
    const byWeekIndex = new Map<number, string>();
    for (const f of fixtures) {
      const weekIndex = Math.floor((new Date(f.kickoff_at).getTime() - seasonStartMs) / WEEK_MS);
      const existingDeadline = byWeekIndex.get(weekIndex);
      if (!existingDeadline || f.kickoff_at < existingDeadline) {
        byWeekIndex.set(weekIndex, f.kickoff_at);
      }
    }
    const sortedWeekIndexes = [...byWeekIndex.keys()].sort((a, b) => a - b);
    sortedWeekIndexes.forEach((weekIndex, i) => {
      const number = i + 1;
      groups.set(number, { number, deadlineAt: byWeekIndex.get(weekIndex)! });
    });
  }

  const { data: existingGameweeks, error: existingError } = await supabase
    .from("fantasy_gameweeks")
    .select("number")
    .eq("season_id", seasonId);

  if (existingError) {
    console.error("Failed to load existing gameweeks", existingError);
    return { error: "Couldn't check existing gameweeks. Try again." };
  }

  const existingNumbers = new Set((existingGameweeks ?? []).map((g) => g.number));
  const toInsert = [...groups.values()]
    .filter((g) => !existingNumbers.has(g.number))
    .map((g) => ({ season_id: seasonId, number: g.number, deadline_at: g.deadlineAt }));

  if (toInsert.length > 0) {
    const { error: insertError } = await supabase.from("fantasy_gameweeks").insert(toInsert);
    if (insertError) {
      console.error("Failed to insert fantasy gameweeks", insertError);
      return { error: "Couldn't create gameweeks. Try again." };
    }
  }

  // Pick the gameweek to mark current: the earliest deadline still in the
  // future, or (season fully finished) the latest deadline overall, so the
  // squad builder always has something to show rather than "no gameweek".
  const now = new Date().toISOString();
  const { data: allGameweeks, error: allError } = await supabase
    .from("fantasy_gameweeks")
    .select("id, deadline_at")
    .eq("season_id", seasonId)
    .order("deadline_at", { ascending: true });

  if (!allError && allGameweeks && allGameweeks.length > 0) {
    const upcoming = allGameweeks.find((g) => g.deadline_at > now);
    const target = upcoming ?? allGameweeks[allGameweeks.length - 1];

    await supabase
      .from("fantasy_gameweeks")
      .update({ is_current: false })
      .eq("season_id", seasonId)
      .eq("is_current", true)
      .neq("id", target.id);

    await supabase.from("fantasy_gameweeks").update({ is_current: true }).eq("id", target.id).eq("is_current", false);
  }

  await logAudit(profile.id, "generate_fantasy_gameweeks", "fantasy_gameweeks", {
    seasonId,
    recordsProcessed: toInsert.length,
  });

  revalidatePath("/fantasy");
  revalidatePath("/admin/data-health");

  return { error: null, recordsProcessed: toInsert.length };
}
