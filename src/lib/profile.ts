import "server-only";
import { cache } from "react";
import { createServerSupabaseClient } from "./supabase/server";
import { getAuthUser } from "./auth";
import { randomKivoAvatarId } from "./kivo-assets";
import type { Database } from "./supabase/types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

/**
 * The KIVO profile row for the signed-in Supabase Auth user, creating it on
 * first sight. Returns null for a signed-out request.
 *
 * This is now the ONLY thing that provisions a profile. Under Clerk a webhook
 * created the row and this function was a fallback for when that webhook hadn't
 * fired; Supabase Auth has no equivalent webhook wired up, so first-visit
 * creation happens here, inline, on the user's very first authenticated
 * request — which is exactly the path a brand-new signee takes from
 * /sign-up straight into /onboarding.
 *
 * The insert goes through the user's OWN session (not the service-role client),
 * against the `profiles_insert_own` policy that migration 0053 rewrote to
 * `auth_user_id = auth.uid() and role = 'user' and moderation_status = 'active'`.
 * That policy is what makes this safe: a user can only ever insert their own
 * row, cannot self-provision as an admin, and cannot arrive pre-moderated. It
 * also means profile creation no longer depends on SUPABASE_SERVICE_ROLE_KEY
 * being present in the environment at all.
 *
 * Wrapped in React's `cache()`: this is called from `(app)/layout.tsx` and
 * again independently in nearly every page/action under it, so without this a
 * single request would repeat the identity check plus a `profiles` SELECT two
 * to four times. `cache()` only memoizes within a single request (a fresh
 * request gets a fresh cache) — it never persists across requests, so nothing
 * about data freshness changes, only redundant work within one render is
 * collapsed. See https://react.dev/reference/react/cache.
 */
export const getOrCreateProfile = cache(async (): Promise<Profile | null> => {
  const user = await getAuthUser();
  if (!user) return null;

  const supabase = createServerSupabaseClient();
  const { data: existing } = await supabase.from("profiles").select("*").eq("auth_user_id", user.id).maybeSingle();

  if (existing) return existing;

  const { data: created, error } = await supabase
    .from("profiles")
    .insert({
      auth_user_id: user.id,
      // Placeholder handle, same shape as before: unique-by-construction and
      // inside the 3-24 char / [a-z0-9_] constraints on the column. Onboarding's
      // first step immediately invites the user to replace it.
      username: `user_${user.id.replace(/[^a-zA-Z0-9]/g, "").slice(-10)}`,
      // Email-only sign-up gives us no name and no picture. Deliberately not
      // derived from the email local-part — display_name is publicly visible
      // (get_public_profiles), and the email address is not.
      display_name: null,
      avatar_url: null,
      // Same one-time random KIVO avatar assignment the Clerk webhook's
      // user.created handler used to do — a profile must never be left with no
      // avatar assigned at all.
      avatar_type: "kivo",
      avatar_kivo_id: randomKivoAvatarId(),
    })
    .select("*")
    .single();

  if (error) {
    // Concurrent requests (two tabs, two route segments) can both miss the
    // SELECT above and race to insert — the loser hits a unique violation.
    // Re-fetch instead of treating a signed-in user as profile-less.
    if (error.code === "23505") {
      const { data: retried } = await supabase.from("profiles").select("*").eq("auth_user_id", user.id).maybeSingle();
      return retried;
    }
    console.error("Failed to create profile", error);
    return null;
  }

  return created;
});
