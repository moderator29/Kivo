"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { getOrCreateProfile } from "@/lib/profile";
import { resolveAvatarSrc } from "@/lib/kivo-assets";
import { logError } from "@/lib/log";
import {
  MAX_STORED_ACCOUNTS,
  clearSlot,
  findFreeSlot,
  listStoredAccounts,
  readSlotTokens,
  signOutStoredSlot,
  stashSessionInSlot,
  type SessionTokens,
  type StoredAccount,
} from "@/lib/supabase/stored-accounts";

/**
 * The Server Actions behind the "Your accounts" sheet
 * (src/components/auth/account-switcher-sheet.tsx).
 *
 * Everything the sheet knows comes from here, and it is fetched when the sheet
 * opens rather than rendered into the page. Two reasons, and the second is the
 * important one:
 *
 *  - Listing stored accounts costs a Supabase round trip per account, and most
 *    people open the drawer without ever opening this sheet.
 *  - Reading a stored account can rotate its refresh token, and a rotated token
 *    has to be written back to its cookie. Server Components cannot write
 *    cookies — a Server Component doing this would drop the new token on the
 *    floor and silently lose the account a few minutes later. Server Actions
 *    can, so this is the only place these functions are allowed to be called
 *    from. See the header of src/lib/supabase/stored-accounts.ts.
 */

/** The account the viewer is currently using. Same fields as a stored one, so
 *  the sheet renders one shape twice rather than two shapes once. */
export type ActiveAccount = {
  userId: string;
  email: string | null;
  username: string | null;
  displayName: string | null;
  avatarSrc: string | null;
  /** Real XP-ledger total, or null when it could not be read. Never a
   *  stand-in zero. */
  xp: number | null;
};

export type AccountSwitcherState = {
  active: ActiveAccount;
  others: StoredAccount[];
  /** False once every slot is full — the sheet says so instead of offering an
   *  "Add account" button that would have nowhere to put the result. */
  canAddAccount: boolean;
  maxAccounts: number;
};

/** Signed out, or signed in with no readable profile. The sheet renders
 *  nothing rather than guessing. */
export type AccountSwitcherResult = AccountSwitcherState | { unavailable: true };

/**
 * Everything the sheet shows, in one call.
 *
 * The active account is read the ordinary way (verified session, own profile
 * row); the stored ones each go through their own verified session. Nothing
 * here is read from a cookie's own claims about who it belongs to.
 */
export async function getAccountSwitcherState(): Promise<AccountSwitcherResult> {
  const authUser = await getAuthUser();
  if (!authUser) return { unavailable: true };

  const profile = await getOrCreateProfile();
  if (!profile) return { unavailable: true };

  const supabase = createServerSupabaseClient();
  const { data: xp, error: xpError } = await supabase.rpc("get_xp_total", { p_profile_id: profile.id });

  const others = await listStoredAccounts(authUser.id);

  return {
    active: {
      userId: authUser.id,
      email: authUser.email,
      username: profile.username,
      displayName: profile.display_name,
      avatarSrc: resolveAvatarSrc(profile),
      xp: xpError ? null : (xp ?? 0),
    },
    others,
    canAddAccount: others.length < MAX_STORED_ACCOUNTS,
    maxAccounts: MAX_STORED_ACCOUNTS + 1,
  };
}

/** The active session's tokens, for handing to a slot client. Never returned
 *  to a caller outside this module's server boundary. */
async function currentSessionTokens(): Promise<SessionTokens | null> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token || !data.session.refresh_token) return null;
  return {
    userId: data.session.user?.id ?? "",
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  };
}

/**
 * Become the account in `slot`, putting the current one into the slot it
 * vacates.
 *
 * ## Why the order is what it is
 *
 * Two cookie writes have to happen — the outgoing session into the slot, the
 * incoming one into the active cookie — and either can fail on a bad network
 * moment, because `setSession` verifies against Supabase before it persists.
 * The sequence below is chosen so that no ordering of failures can lose a
 * session:
 *
 *   1. Read the target's tokens. Nothing has changed yet, so a failure here is
 *      a clean "that account needs signing in again" with the current session
 *      untouched.
 *   2. Read the current session's tokens, into memory.
 *   3. Write the OUTGOING session into the target's slot. If this fails,
 *      nothing has been overwritten anywhere — abort, still signed in as
 *      before, target still stored.
 *   4. Adopt the incoming session. If THIS fails, step 3 has already replaced
 *      the slot's contents, so it is put back from the tokens still held in
 *      memory (step 1) before returning the error. That compensation is why
 *      step 1 keeps its result rather than re-reading later.
 *
 * The failure that cannot be compensated — 4 succeeds, so the user IS switched,
 * and the restore in the error path never runs — is the good case.
 */
export async function switchToStoredAccount(slot: number): Promise<{ error: string }> {
  const authUser = await getAuthUser();
  if (!authUser) return { error: "You're signed out. Sign in again." };

  const targetTokens = await readSlotTokens(slot);
  if (!targetTokens) {
    // The stored session is gone (expired, or signed out from another device).
    // Clear the row rather than leave a button that fails every time.
    await clearSlot(slot);
    return { error: "That account's session has expired. Add it again to switch to it." };
  }

  const outgoing = await currentSessionTokens();
  if (!outgoing) return { error: "Your current session couldn't be read. Reload and try again." };

  if (outgoing.userId && outgoing.userId === targetTokens.userId) {
    // Already signed in as this account — the slot is a duplicate of the
    // active session, which `listStoredAccounts` also cleans up. Drop it and
    // land the user where a successful switch would have.
    await clearSlot(slot);
    revalidatePath("/", "layout");
    redirect("/home");
  }

  const stashed = await stashSessionInSlot(slot, outgoing);
  if (stashed.error) return { error: "Couldn't keep your current account signed in, so nothing was switched." };

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.auth.setSession({
    access_token: targetTokens.accessToken,
    refresh_token: targetTokens.refreshToken,
  });

  if (error || !data.session) {
    logError("account-switcher.adopt", error, { slot });
    // Put the target back where it was — step 3 overwrote its slot with the
    // account we are still signed in as.
    const restored = await stashSessionInSlot(slot, targetTokens);
    if (restored.error) {
      logError("account-switcher.restoreFailed", restored.error, {
        slot,
        detail: "A switch failed after the target's slot had been overwritten, and the target could not be put back.",
      });
    }
    return { error: "Couldn't switch accounts. Try again." };
  }

  // The whole tree, not just one route. `revalidatePath("/", "layout")` is
  // documented by Next 16 as purging the Client Cache and invalidating all
  // cached data (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md,
  // "Revalidating all data") — which is exactly the requirement here: the
  // browser is holding RSC payloads rendered for the account we just left, and
  // any one of them would otherwise be shown to the account we just became on
  // a back-navigation or a soft link.
  revalidatePath("/", "layout");

  // Deliberately not `getAuthUser()` / `resolveViewerProfile()`: both are
  // React `cache()`d and already answered for the OUTGOING account earlier in
  // this same request, so calling them now would confidently return the wrong
  // person. The user object `setSession` just returned is the freshly verified
  // one, so onboarding state is read against that id directly.
  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed")
    .eq("auth_user_id", data.session.user.id)
    .maybeSingle();

  // redirect() throws NEXT_REDIRECT — must stay outside any try/catch.
  redirect(profile && !profile.onboarding_completed ? "/onboarding" : "/home");
}

/**
 * Sign a stored account out for real, from the switcher.
 *
 * Not "remove from this list": `signOutStoredSlot` revokes the session with
 * Supabase before deleting the cookie. A control labelled "Sign out" that only
 * hid a live credential would be the single worst thing this feature could
 * ship, so it is the one behaviour with a test of its own.
 */
export async function signOutStoredAccount(slot: number): Promise<{ error: string | null }> {
  const authUser = await getAuthUser();
  if (!authUser) return { error: "You're signed out. Sign in again." };
  return signOutStoredSlot(slot);
}

/**
 * Where "Add account" goes, and the reason it is an action rather than a plain
 * link: it refuses when there is nowhere to put the result.
 *
 * Nothing is stashed here. The current session is left completely alone until
 * a NEW one actually arrives (see `verifyEmailCode` in src/lib/auth-actions.ts),
 * which is what makes abandoning the flow half-way a no-op — close the tab at
 * the code screen and the account you were using is still the account you are
 * using.
 */
export async function beginAddAccount(): Promise<{ error: string }> {
  const authUser = await getAuthUser();
  if (!authUser) return { error: "You're signed out. Sign in again." };

  const free = await findFreeSlot();
  if (free === null) {
    return { error: `You can keep ${MAX_STORED_ACCOUNTS + 1} accounts on this device. Sign one out first.` };
  }

  redirect("/sign-in?add=1");
}
