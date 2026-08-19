import "server-only";
import { cache } from "react";
import { createServerSupabaseClient } from "./supabase/server";
import { getAuthUser } from "./auth";
import { randomKivoAvatarId } from "./kivo-assets";
import { COUNTRY_CODES } from "./countries";
import { FULL_NAME_MAX, USERNAME_PATTERN, normalizeUsername } from "./auth-shared";
import type { Database } from "./supabase/types";
import { logError } from "@/lib/log";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

/**
 * Why this exists rather than just `Profile | null`.
 *
 * "Nobody is signed in" and "somebody IS signed in but their profile row could
 * not be read or created" are completely different situations that both used to
 * collapse into `null`. Treating the second as the first is what produces an
 * infinite redirect: the app group sends them to /sign-in, /sign-in sees a
 * perfectly valid session and sends them back, forever — indistinguishable, to
 * the person on the other end, from sign-in silently failing.
 *
 * So the two are named. `anonymous` redirects to sign-in; `unavailable` has to
 * terminate somewhere honest with a retry (see
 * src/components/auth/profile-unavailable.tsx). Never a redirect.
 */
export type ProfileResolution =
  | { status: "anonymous" }
  | { status: "ready"; profile: Profile }
  | { status: "unavailable" };

/**
 * Resolves who the viewer is: the KIVO profile row for the signed-in Supabase
 * Auth user, creating it on first sight, and distinguishing "signed out" from
 * "signed in but the row is not available" (see ProfileResolution above).
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
export const resolveViewerProfile = cache(async (): Promise<ProfileResolution> => {
  const user = await getAuthUser();
  if (!user) return { status: "anonymous" };

  const supabase = createServerSupabaseClient();
  const { data: existing } = await supabase.from("profiles").select("*").eq("auth_user_id", user.id).maybeSingle();

  if (existing) return { status: "ready", profile: existing };

  // What the person typed on /sign-up, carried across the verification round
  // trip as Supabase user metadata. Read here because THIS is the only place a
  // profile row is ever created, and both halves of verification land here —
  // the typed code and the emailed link.
  const requested = await requestedIdentity();
  const placeholderUsername = `user_${user.id.replace(/[^a-zA-Z0-9]/g, "").slice(-10)}`;

  const insert = async (username: string, withRequestedIdentity: boolean) =>
    supabase
      .from("profiles")
      .insert({
        auth_user_id: user.id,
        username,
        // display_name is publicly visible (get_public_profiles) and the email
        // address is not, so this is never derived from the email local-part.
        // It is either the name the user gave us at sign-up or nothing.
        display_name: withRequestedIdentity ? requested.fullName : null,
        country: withRequestedIdentity ? requested.country : null,
        avatar_url: null,
        // Same one-time random KIVO avatar assignment the Clerk webhook's
        // user.created handler used to do — a profile must never be left with no
        // avatar assigned at all.
        avatar_type: "kivo",
        avatar_kivo_id: randomKivoAvatarId(),
      })
      .select("*")
      .single();

  const { data: created, error } = await insert(requested.username ?? placeholderUsername, true);

  if (error) {
    // Concurrent requests (two tabs, two route segments) can both miss the
    // SELECT above and race to insert — the loser hits a unique violation.
    // Re-fetch instead of treating a signed-in user as profile-less.
    if (error.code === "23505") {
      const { data: retried } = await supabase.from("profiles").select("*").eq("auth_user_id", user.id).maybeSingle();
      if (retried) return { status: "ready", profile: retried };

      // Not this user's own row, then: the UNIQUE constraint on
      // profiles.username fired because somebody else claimed the handle in the
      // window between /sign-up checking it and this verification landing.
      // Nothing was reserved at sign-up time (that would need a table of held
      // names and an expiry sweep for a race that needs two people picking the
      // same handle within minutes), so this is the recovery: provision them on
      // the placeholder handle and let onboarding ask for a new one — which is
      // exactly the case onboarding's username step still exists for. Losing
      // the handle is a disappointment; refusing to create the account for
      // somebody who has just verified their email is a lockout.
      if (requested.username) {
        const { data: fallback, error: fallbackError } = await insert(placeholderUsername, true);
        if (fallback) return { status: "ready", profile: fallback };
        logError("profile.createAfterUsernameTaken", fallbackError);
      }
      return { status: "unavailable" };
    }
    logError("profile.create", error);
    return { status: "unavailable" };
  }

  return { status: "ready", profile: created };
});

/**
 * The identity the user gave us on /sign-up, pulled back off the Supabase user
 * and re-validated from scratch.
 *
 * `raw_user_meta_data` is NOT a trusted store: any signed-in user can write
 * anything into it with `updateUser({ data })`. So every field is checked here
 * against the same rules signUpWithPassword checked, and anything that does not
 * pass is dropped rather than repaired. The fields that would actually matter
 * if this were trusted — `role`, `moderation_status` — are not read at all, and
 * the `profiles_insert_own` RLS policy independently pins them
 * (`role = 'user' and moderation_status = 'active'`, migration 0053), so a
 * doctored metadata blob cannot self-provision an admin even if this function
 * were wrong.
 *
 * Uniqueness is deliberately NOT checked here. The UNIQUE constraint on
 * profiles.username is the boundary, it is one round trip away, and asking a
 * second question first would only widen the window it exists to close.
 */
async function requestedIdentity(): Promise<{ username: string | null; fullName: string | null; country: string | null }> {
  const empty = { username: null, fullName: null, country: null };

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return empty;

  const metadata = data.user.user_metadata ?? {};

  const rawUsername = typeof metadata.username === "string" ? normalizeUsername(metadata.username) : "";
  const username = USERNAME_PATTERN.test(rawUsername) ? rawUsername : null;

  const rawName = typeof metadata.full_name === "string" ? metadata.full_name.trim().replace(/\s+/g, " ") : "";
  const fullName = rawName.length >= 1 && rawName.length <= FULL_NAME_MAX ? rawName : null;

  const rawCountry = typeof metadata.country === "string" ? metadata.country.trim().toUpperCase() : "";
  const country = (COUNTRY_CODES as readonly string[]).includes(rawCountry) ? rawCountry : null;

  return { username, fullName, country };
}

/**
 * The signed-in viewer's profile, or null.
 *
 * Kept as the ordinary way to ask, because most callers genuinely only need
 * "is there a profile to act as?" — a guest and a broken profile are equally
 * "no" to a page that just wants to show a follow button. Anything that
 * decides where to send the user instead of what to render must use
 * `resolveViewerProfile()` and handle `unavailable` without redirecting.
 */
export async function getOrCreateProfile(): Promise<Profile | null> {
  const resolution = await resolveViewerProfile();
  return resolution.status === "ready" ? resolution.profile : null;
}
