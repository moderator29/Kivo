"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { occupiedSlots, signOutStoredSlot } from "@/lib/supabase/stored-accounts";
import { logError } from "@/lib/log";

/**
 * Ending a session, as opposed to starting one.
 *
 * Sign-in/sign-up live in `src/lib/auth-actions.ts` alongside the OTP request
 * and verify steps; these two are the settings-and-account-menu half of the
 * same story and are kept apart so the sign-in flow's module stays a single
 * readable sequence.
 */

/**
 * Sign out of *this* device only.
 *
 * Supabase's `signOut()` defaults to `scope: "global"`, which terminates every
 * session the user has on every device — the opposite of what a "Sign out"
 * item in an account menu means to the person clicking it, and not what
 * Clerk's `<SignOutButton>`/`useAuth().signOut()` (what this replaced) did
 * either. So the scope is passed explicitly. `signOutOtherDevices()` below is
 * the deliberate, separately-labelled way to reach the wider behaviour.
 *
 * Redirects to the marketing page rather than returning, so a signed-out
 * viewer never lands on a page that was rendered for their now-dead session.
 *
 * "This device" is taken literally: any accounts kept for switching are signed
 * out too. See the comment inside for why that is not optional.
 */
export async function signOut() {
  const supabase = createServerSupabaseClient();
  await supabase.auth.signOut({ scope: "local" });

  // Every OTHER account stored on this device goes with it, revoked rather
  // than merely forgotten.
  //
  // This is not tidiness, it is the security half of multi-account switching.
  // A stored account is a live credential (see the header of
  // src/lib/supabase/stored-accounts.ts), and the only surface that can revoke
  // one is the switcher sheet — which lives inside the signed-in app. Leaving
  // them behind would mean a device whose owner has deliberately signed out
  // still holds working sessions for two or three accounts, with no screen
  // anywhere in the product from which to reach them. "Sign out" on a device
  // has to mean the device, or it means nothing.
  //
  // Failures are already swallowed-and-logged inside signOutStoredSlot, and it
  // clears the cookie either way, so this cannot leave the user stuck on a
  // sign-out that half worked.
  for (const slot of await occupiedSlots()) {
    await signOutStoredSlot(slot);
  }

  redirect("/");
}

/**
 * Terminates every OTHER session for this user, keeping the caller's own.
 *
 * This is what replaced the Clerk-backed "Active sessions" panel (see
 * DECISIONS.md, 2026-08-18, and RECOMMENDATIONS.md item 299). Supabase Auth
 * has no API for enumerating a user's individual device sessions or revoking
 * one of them by id — `auth.sessions` lives in the `auth` schema, which is
 * deliberately not exposed through the API, and neither `supabase.auth` nor
 * `supabase.auth.admin` offers a list/revoke-by-id call. `scope: "others"` is
 * the real, supported capability that remains, so it is the one offered.
 *
 * Note the honest limit, which is Supabase's, not KIVO's: revoked sessions'
 * refresh tokens are destroyed immediately, but an access token already
 * issued to another device stays valid until it expires (1 hour by default).
 * The panel's copy says this rather than implying an instant kill.
 */
export async function signOutOtherDevices(): Promise<{ error: string | null }> {
  const supabase = createServerSupabaseClient();

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) return { error: "You must be signed in." };

  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) {
    logError("session-actions.signOutOtherDevices", error);
    return { error: "Something went wrong. Try again." };
  }

  return { error: null };
}
