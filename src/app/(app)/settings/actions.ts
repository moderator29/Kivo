"use server";

import { revalidatePath } from "next/cache";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { isClerkConfigured } from "@/lib/clerk";
import { COUNTRY_CODES } from "@/lib/countries";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  NOTIFICATION_PREFERENCE_COLUMNS,
  NOTIFICATION_PREFERENCE_DEFAULTS,
  type NotificationPreferenceColumn,
} from "@/lib/notification-preferences";
import type { Database } from "@/lib/supabase/types";

// Matches the `profiles_bio_length` check constraint in
// supabase/migrations/0001_kivo_core_schema.sql (char_length(bio) <= 500).
const MAX_BIO_LENGTH = 500;

export async function getNotificationPreferences(
  profileId: string,
): Promise<Record<NotificationPreferenceColumn, boolean>> {
  const supabase = createServerSupabaseClient();
  // Column list kept as a literal (not NOTIFICATION_PREFERENCE_COLUMNS.join(","))
  // so supabase-js can infer the row type from the query string itself; the
  // two are kept in sync by hand, both being short and rarely changing.
  const { data } = await supabase
    .from("notification_preferences")
    .select(
      "email_enabled, push_enabled, in_app_enabled, marketing_emails_enabled, match_alerts_enabled, social_alerts_enabled, prediction_alerts_enabled, fantasy_alerts_enabled",
    )
    .eq("profile_id", profileId)
    .maybeSingle();

  if (!data) return { ...NOTIFICATION_PREFERENCE_DEFAULTS };

  return {
    email_enabled: data.email_enabled,
    push_enabled: data.push_enabled,
    in_app_enabled: data.in_app_enabled,
    marketing_emails_enabled: data.marketing_emails_enabled,
    match_alerts_enabled: data.match_alerts_enabled,
    social_alerts_enabled: data.social_alerts_enabled,
    prediction_alerts_enabled: data.prediction_alerts_enabled,
    fantasy_alerts_enabled: data.fantasy_alerts_enabled,
  };
}

// Building `{ profile_id, [column]: value }` via a computed property loses
// the literal-key type PostgREST's upsert() needs (it widens to a string
// index signature, which upsert()'s overloads reject) — an explicit switch
// keeps every branch a concrete, exact-shaped payload instead.
function buildPreferencePayload(
  column: NotificationPreferenceColumn,
  value: boolean,
  profileId: string,
): Database["public"]["Tables"]["notification_preferences"]["Insert"] {
  switch (column) {
    case "email_enabled":
      return { profile_id: profileId, email_enabled: value };
    case "push_enabled":
      return { profile_id: profileId, push_enabled: value };
    case "in_app_enabled":
      return { profile_id: profileId, in_app_enabled: value };
    case "marketing_emails_enabled":
      return { profile_id: profileId, marketing_emails_enabled: value };
    case "match_alerts_enabled":
      return { profile_id: profileId, match_alerts_enabled: value };
    case "social_alerts_enabled":
      return { profile_id: profileId, social_alerts_enabled: value };
    case "prediction_alerts_enabled":
      return { profile_id: profileId, prediction_alerts_enabled: value };
    case "fantasy_alerts_enabled":
      return { profile_id: profileId, fantasy_alerts_enabled: value };
  }
}

export async function updateNotificationPreference(column: NotificationPreferenceColumn, value: boolean) {
  if (!NOTIFICATION_PREFERENCE_COLUMNS.includes(column)) {
    return { error: "Unknown preference." };
  }

  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in." };

  const supabase = createServerSupabaseClient();
  // upsert with only { profile_id, [column]: value } in the payload leaves
  // every other column untouched on conflict (ON CONFLICT DO UPDATE SET only
  // covers the columns present in the payload) and falls back to the
  // notification_preferences table defaults for a brand-new row.
  const { error } = await supabase
    .from("notification_preferences")
    .upsert(buildPreferencePayload(column, value, profile.id), { onConflict: "profile_id" });

  if (error) {
    console.error("Failed to update notification preference", error);
    return { error: "Something went wrong. Try again." };
  }

  revalidatePath("/settings");
  return { error: null };
}

export async function updateProfileDetails(formData: FormData) {
  const bio = String(formData.get("bio") ?? "").trim();
  const countryRaw = String(formData.get("country") ?? "").trim().toUpperCase();
  const country = countryRaw.length > 0 ? countryRaw : null;

  if (bio.length > MAX_BIO_LENGTH) {
    return { error: `Bio must be ${MAX_BIO_LENGTH} characters or fewer.` };
  }
  if (country !== null && !COUNTRY_CODES.includes(country as (typeof COUNTRY_CODES)[number])) {
    return { error: "Choose a valid country." };
  }

  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in." };

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("profiles")
    .update({ bio: bio.length > 0 ? bio : null, country })
    .eq("id", profile.id);

  if (error) {
    console.error("Failed to update profile details", error);
    return { error: "Something went wrong. Try again." };
  }

  revalidatePath("/settings");
  return { error: null };
}

/**
 * Deletes the caller's Clerk user, which in turn fires the existing
 * `user.deleted` webhook (src/app/api/webhooks/clerk/route.ts) that already
 * cascades the Supabase-side cleanup (profiles row + everything FK-cascaded
 * off it). This action's only job is to safely trigger that deletion after
 * the client-side confirmation step — it must never duplicate the cascade.
 */
export async function deleteAccount() {
  if (!isClerkConfigured()) return { error: "Account deletion is unavailable right now." };

  const { userId } = await auth();
  if (!userId) return { error: "You must be signed in." };

  try {
    const client = await clerkClient();
    await client.users.deleteUser(userId);
  } catch (error) {
    console.error("Failed to delete Clerk user", error);
    return { error: "Something went wrong. Try again." };
  }

  return { error: null };
}

/**
 * RECOMMENDATIONS.md item 135: settings had a delete-account flow but no
 * data export, even though `DeleteAccountSection`'s own copy already lists
 * exactly what a deleted account destroys ("your profile, posts, comments,
 * predictions, fantasy teams and XP") — this exports that same real data
 * (plus follows/saves/badges, also FK-cascaded away on deletion) as one
 * JSON object, so a user can see or keep what they have before, or instead
 * of, deleting it. Every table read here through the session-scoped client
 * (never service-role) so RLS's own `_select_own` policies are the actual
 * enforcement, same as every other read in this file — this function only
 * narrows further with `.eq(ownerColumn, profile.id)`, it never widens.
 */
export type UserDataExport = {
  exportedAt: string;
  profile: Database["public"]["Tables"]["profiles"]["Row"];
  posts: Database["public"]["Tables"]["posts"]["Row"][];
  comments: Database["public"]["Tables"]["comments"]["Row"][];
  predictions: Database["public"]["Tables"]["predictions"]["Row"][];
  fantasyTeams: Database["public"]["Tables"]["fantasy_teams"]["Row"][];
  fantasyRosters: Database["public"]["Tables"]["fantasy_rosters"]["Row"][];
  follows: Database["public"]["Tables"]["follows"]["Row"][];
  saves: Database["public"]["Tables"]["saves"]["Row"][];
  badges: { badgeId: string; code: string; name: string; description: string | null; awardedAt: string }[];
  xpLedger: Database["public"]["Tables"]["xp_ledger"]["Row"][];
};

export async function exportUserData(): Promise<{ error: string | null; data: UserDataExport | null }> {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in.", data: null };

  // Modest cap — this is a handful of read queries, not a write path, but
  // every user-triggered action in this codebase gets a rate limit (item
  // 198) and an export is still real DB load an unthrottled script could
  // hammer.
  const rateLimit = await checkRateLimit(`user:${profile.id}`, "export_user_data", 3, 300);
  if (!rateLimit.ok) return { error: rateLimit.error, data: null };

  const supabase = createServerSupabaseClient();

  const [
    { data: posts },
    { data: comments },
    { data: predictions },
    { data: fantasyTeams },
    { data: follows },
    { data: saves },
    { data: userBadgeRows },
    { data: xpLedger },
  ] = await Promise.all([
    supabase.from("posts").select("*").eq("author_profile_id", profile.id).order("created_at", { ascending: false }),
    supabase.from("comments").select("*").eq("author_profile_id", profile.id).order("created_at", { ascending: false }),
    supabase.from("predictions").select("*").eq("profile_id", profile.id).order("created_at", { ascending: false }),
    supabase.from("fantasy_teams").select("*").eq("owner_profile_id", profile.id).order("created_at", { ascending: false }),
    supabase.from("follows").select("*").eq("follower_profile_id", profile.id).order("created_at", { ascending: false }),
    supabase.from("saves").select("*").eq("profile_id", profile.id).order("created_at", { ascending: false }),
    supabase.from("user_badges").select("badge_id, awarded_at").eq("profile_id", profile.id).order("awarded_at", { ascending: false }),
    supabase.from("xp_ledger").select("*").eq("profile_id", profile.id).order("created_at", { ascending: false }),
  ]);

  // fantasy_rosters has no profile_id of its own (see migration
  // 0001_kivo_core_schema.sql) — it's keyed on fantasy_team_id, so this
  // scopes to the team ids just fetched above rather than a fifth
  // independent query with nothing to filter on.
  const fantasyTeamIds = (fantasyTeams ?? []).map((team) => team.id);
  const { data: fantasyRosters } = fantasyTeamIds.length
    ? await supabase
        .from("fantasy_rosters")
        .select("*")
        .in("fantasy_team_id", fantasyTeamIds)
        .order("created_at", { ascending: false })
    : { data: [] as Database["public"]["Tables"]["fantasy_rosters"]["Row"][] };

  // Two-step lookup (badge ids -> badge rows) rather than an embedded
  // `badges(...)` select, matching this codebase's existing convention of
  // resolving small reference tables in a second query (see grounding.ts's
  // follows resolution) instead of relying on PostgREST's FK-embed syntax.
  const badgeIds = Array.from(new Set((userBadgeRows ?? []).map((row) => row.badge_id)));
  const { data: badgeRows } = badgeIds.length
    ? await supabase.from("badges").select("id, code, name, description").in("id", badgeIds)
    : { data: [] as { id: string; code: string; name: string; description: string | null }[] };
  const badgeById = new Map((badgeRows ?? []).map((badge) => [badge.id, badge]));
  const badges = (userBadgeRows ?? []).map((row) => {
    const badge = badgeById.get(row.badge_id);
    return {
      badgeId: row.badge_id,
      code: badge?.code ?? row.badge_id,
      name: badge?.name ?? "Unknown badge",
      description: badge?.description ?? null,
      awardedAt: row.awarded_at,
    };
  });

  return {
    error: null,
    data: {
      exportedAt: new Date().toISOString(),
      profile,
      posts: posts ?? [],
      comments: comments ?? [],
      predictions: predictions ?? [],
      fantasyTeams: fantasyTeams ?? [],
      fantasyRosters: fantasyRosters ?? [],
      follows: follows ?? [],
      saves: saves ?? [],
      badges,
      xpLedger: xpLedger ?? [],
    },
  };
}
