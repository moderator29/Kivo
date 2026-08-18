"use server";

import { logError } from "@/lib/log";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { COUNTRY_CODES } from "@/lib/countries";
import { isSupportedTimeZone } from "@/lib/timezone";
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
    logError("settings.updateNotificationPreference", error);
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
    logError("settings.updateProfileDetails", error);
    return { error: "Something went wrong. Try again." };
  }

  revalidatePath("/settings");
  return { error: null };
}

/**
 * RECOMMENDATIONS.md item 286: profiles had no privacy control at all over
 * what a public visitor sees on /u/[username] — get_public_profile_stats
 * (migration 0048) returns full XP + badges to any caller unless this column
 * says otherwise. Same self-service update path as updateProfileDetails
 * above (profiles_update_own_or_admin already allows the owner to touch this
 * column; no RLS change needed).
 */
export async function updateActivityVisibility(showActivityPublicly: boolean) {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in." };

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("profiles")
    .update({ show_activity_publicly: showActivityPublicly })
    .eq("id", profile.id);

  if (error) {
    logError("settings.updateActivityVisibility", error);
    return { error: "Something went wrong. Try again." };
  }

  revalidatePath("/settings");
  return { error: null };
}

/**
 * KN-89. The only writer of `profiles.timezone` (migration 0054), and
 * deliberately the only one there will ever be: the value comes from the user
 * confirming their own device's zone, never from IP geolocation.
 *
 * Three validation layers, none redundant. This action rejects anything the
 * runtime's own ICU data does not know (`isSupportedTimeZone`), so a typo or a
 * hand-crafted request never reaches Postgres. Migration 0054's trigger checks
 * the same thing against `pg_timezone_names`, which is the copy that actually
 * matters for anything the database computes. And the column's shape
 * constraint means the field cannot become free text even if the trigger were
 * dropped.
 *
 * `null` is a first-class value, not a failure: "clear my timezone" is a real
 * choice, and every consumer falls back to UTC and says so (see
 * src/lib/timezone.ts) rather than pretending to know.
 */
export async function updateTimezone(timezone: string | null) {
  const value = typeof timezone === "string" ? timezone.trim() : null;

  if (value !== null && value.length > 0 && !isSupportedTimeZone(value)) {
    return { error: "That isn't a time zone we recognise." };
  }

  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in." };

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("profiles")
    .update({ timezone: value && value.length > 0 ? value : null })
    .eq("id", profile.id);

  if (error) {
    logError("settings.updateTimezone", error);
    return { error: "Something went wrong. Try again." };
  }

  revalidatePath("/settings");
  return { error: null };
}

/**
 * Deletes the caller's Supabase Auth user. `profiles.auth_user_id` is
 * `references auth.users (id) on delete cascade`
 * (supabase/migrations/0053_supabase_auth_identity.sql), so removing the auth
 * user removes the profile row and — through the existing profile_id FKs —
 * everything owned by it. That cascade is now the whole deletion path; it used
 * to be triggered indirectly, by deleting the Clerk user and letting the
 * `user.deleted` webhook do the Supabase-side work.
 *
 * The storage sweep is not optional bookkeeping. Supabase refuses to delete an
 * auth user who still owns objects in Storage
 * (https://supabase.com/docs/guides/auth/managing-user-data), and any user who
 * has ever uploaded their own avatar owns objects in the `avatars` bucket at
 * `<auth_user_id>/<timestamp>.<ext>` (see avatar-actions.ts). Without this,
 * deleteUser() would fail for exactly those users — the ones most likely to
 * have real data worth deleting — and the error would look like an unrelated
 * server fault. Objects are removed with the service-role client because the
 * user's own session is about to stop existing.
 *
 * Runs entirely on the service-role client, so it is guarded by the
 * `getUser()` check above it: that call verifies the session against Supabase
 * rather than trusting a cookie, and every id used below comes from it, never
 * from client input.
 */
export async function deleteAccount() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const admin = createServiceRoleSupabaseClient();

  try {
    const { data: objects } = await admin.storage.from("avatars").list(user.id);
    if (objects && objects.length > 0) {
      const { error: removeError } = await admin.storage
        .from("avatars")
        .remove(objects.map((object) => `${user.id}/${object.name}`));
      if (removeError) {
        logError("settings.removeAvatarObjectsAccount", removeError);
        return { error: "Something went wrong. Try again." };
      }
    }

    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) {
      logError("settings.deleteSupabaseAuthUser", error);
      return { error: "Something went wrong. Try again." };
    }
  } catch (error) {
    logError("settings.deleteAccount", error);
    return { error: "Something went wrong. Try again." };
  }

  // The session's refresh token dies with the user, but the cookie itself and
  // the already-issued access token do not — clearing them here is what makes
  // the redirect that follows land on a genuinely signed-out app rather than
  // on pages rendering against a user row that no longer exists.
  await supabase.auth.signOut({ scope: "local" });

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
  // KIVO_NEXT_GEN KN-112: eight categories of real user data were missing from
  // a feature whose button says "Download my data". Every user-owned table is
  // now covered, and USER_DATA_CATEGORIES (src/lib/user-data.ts) is the shared
  // list that keeps this and the on-screen summary describing the same set.
  reactions: Database["public"]["Tables"]["reactions"]["Row"][];
  pollVotes: Database["public"]["Tables"]["poll_votes"]["Row"][];
  fanRatings: Database["public"]["Tables"]["fan_ratings"]["Row"][];
  aiConversations: Database["public"]["Tables"]["ai_conversations"]["Row"][];
  aiMessages: Database["public"]["Tables"]["ai_messages"]["Row"][];
  notifications: Database["public"]["Tables"]["notifications"]["Row"][];
  notificationPreferences: Database["public"]["Tables"]["notification_preferences"]["Row"] | null;
  supportRequests: Database["public"]["Tables"]["support_requests"]["Row"][];
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
    { data: reactions },
    { data: pollVotes },
    { data: fanRatings },
    { data: aiConversations },
    { data: notifications },
    { data: notificationPreferences },
    { data: supportRequests },
  ] = await Promise.all([
    supabase.from("posts").select("*").eq("author_profile_id", profile.id).order("created_at", { ascending: false }),
    supabase.from("comments").select("*").eq("author_profile_id", profile.id).order("created_at", { ascending: false }),
    supabase.from("predictions").select("*").eq("profile_id", profile.id).order("created_at", { ascending: false }),
    supabase.from("fantasy_teams").select("*").eq("owner_profile_id", profile.id).order("created_at", { ascending: false }),
    supabase.from("follows").select("*").eq("follower_profile_id", profile.id).order("created_at", { ascending: false }),
    supabase.from("saves").select("*").eq("profile_id", profile.id).order("created_at", { ascending: false }),
    supabase.from("user_badges").select("badge_id, awarded_at").eq("profile_id", profile.id).order("awarded_at", { ascending: false }),
    supabase.from("xp_ledger").select("*").eq("profile_id", profile.id).order("created_at", { ascending: false }),
    supabase.from("reactions").select("*").eq("profile_id", profile.id).order("created_at", { ascending: false }),
    supabase.from("poll_votes").select("*").eq("profile_id", profile.id).order("created_at", { ascending: false }),
    supabase.from("fan_ratings").select("*").eq("profile_id", profile.id).order("created_at", { ascending: false }),
    supabase.from("ai_conversations").select("*").eq("profile_id", profile.id).order("created_at", { ascending: false }),
    supabase.from("notifications").select("*").eq("profile_id", profile.id).order("created_at", { ascending: false }),
    supabase.from("notification_preferences").select("*").eq("profile_id", profile.id).maybeSingle(),
    supabase.from("support_requests").select("*").eq("profile_id", profile.id).order("created_at", { ascending: false }),
  ]);

  // fantasy_rosters has no profile_id of its own (see migration
  // 0001_kivo_core_schema.sql) — it's keyed on fantasy_team_id, so this
  // scopes to the team ids just fetched above rather than a fifth
  // independent query with nothing to filter on.
  // ai_messages hangs off ai_conversations the same way fantasy_rosters hangs
  // off fantasy_teams — no owner column of its own, so it is scoped to the
  // conversation ids just fetched rather than left out for lack of one.
  const conversationIds = (aiConversations ?? []).map((c) => c.id);
  const { data: aiMessages } = conversationIds.length
    ? await supabase
        .from("ai_messages")
        .select("*")
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: false })
    : { data: [] as Database["public"]["Tables"]["ai_messages"]["Row"][] };

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
      reactions: reactions ?? [],
      pollVotes: pollVotes ?? [],
      fanRatings: fanRatings ?? [],
      aiConversations: aiConversations ?? [],
      aiMessages: aiMessages ?? [],
      notifications: notifications ?? [],
      notificationPreferences: notificationPreferences ?? null,
      supportRequests: supportRequests ?? [],
    },
  };
}
