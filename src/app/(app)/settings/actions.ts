"use server";

import { revalidatePath } from "next/cache";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { isClerkConfigured } from "@/lib/clerk";
import { COUNTRY_CODES } from "@/lib/countries";
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
