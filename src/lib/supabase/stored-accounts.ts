import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/log";
import { resolveAvatarSrc } from "@/lib/kivo-assets";
import type { Database } from "./types";

/**
 * Multi-account switching: how a second (third, fourth) KIVO session is held
 * on one device without either of them being signed out.
 *
 * READ THIS BEFORE CHANGING ANYTHING HERE. The whole feature is a cookie
 * layout, and every security property it has comes from the layout rather than
 * from any check further up.
 *
 * ## What Supabase Auth actually gives us
 *
 * A `@supabase/ssr` client keeps exactly one session, in the cookie named by
 * its `storageKey` — `sb-<project-ref>-auth-token` by default, chunked as
 * `.0`, `.1`, … when the payload outgrows one cookie. There is no "list my
 * sessions" API and no way to hold two sessions in one client: `auth.sessions`
 * lives in the `auth` schema, which is deliberately not exposed through the
 * API (the same wall `signOutOtherDevices()` in src/app/(app)/session-actions.ts
 * documents). So multi-account cannot be a Supabase feature we switch on.
 *
 * What it CAN be is several independent clients, each pointed at a different
 * cookie name. `createServerClient({ cookieOptions: { name } })` sets the
 * client's `storageKey` to that name (see createServerClient.js in
 * @supabase/ssr), and `applyServerStorage` only ever writes cookies whose name
 * is chunk-like for that one key — so a client bound to `kivo-account-1`
 * physically cannot touch the active session's cookies, and vice versa. That
 * isolation is what makes this safe to build at all, and it is a property of
 * the library, verified in src/lib/supabase/stored-accounts.test.ts rather
 * than assumed.
 *
 * ## The layout
 *
 * - The ACTIVE session stays exactly where it has always been, written by the
 *   default client in src/lib/supabase/server.ts. Nothing in this file changes
 *   how the signed-in user is read, refreshed or authorized. If every stored
 *   account were deleted, the app would behave identically.
 * - Each INACTIVE account occupies one numbered slot, `kivo-account-<n>`.
 *
 * ## The security decisions, and they are decisions
 *
 * 1. **A stored session is a live credential.** Anyone holding the device can
 *    switch into it without re-verifying an email code. That is exactly how
 *    Instagram, X and Gmail behave, and it is the entire point of the feature —
 *    but it IS a real change to KIVO's security posture and it is written down
 *    in DECISIONS.md rather than left implicit. The mitigations that follow are
 *    what keep it to that one property and no more.
 *
 * 2. **Slot cookies are `httpOnly`, the active session's are not.** The active
 *    cookie cannot be `httpOnly`: the browser Supabase client
 *    (src/lib/supabase/client.ts) reads it from `document.cookie` for realtime
 *    and client-side queries. Nothing client-side has any reason to read a
 *    stored account's session, so these are locked away from JavaScript
 *    entirely. That makes the stored credential strictly harder to steal than
 *    the active one, never easier — which is the only direction this is allowed
 *    to move.
 *
 * 3. **Identity is never read from the cookie's claims about itself.** Every
 *    listing goes through `auth.getUser()` on the slot's own client, which is a
 *    network call Supabase answers only for a session that is still valid. A
 *    slot that fails is not shown and is cleared. This is why the switcher
 *    cannot be made to display a stranger's email by hand-editing a cookie, and
 *    why an account signed out from another device disappears from the sheet
 *    instead of lingering as a dead row.
 *
 * 4. **Signing a stored account out really signs it out.** `signOutStoredSlot`
 *    calls Supabase's logout endpoint with that session's own access token
 *    before deleting the cookie, so the refresh token is destroyed server-side.
 *    Deleting the cookie alone would leave a live refresh token in the wild and
 *    a user who believes they revoked it.
 *
 * 5. **`encode: "tokens-only"`.** The slot cookie carries the access and
 *    refresh tokens and not the serialized user object, which roughly halves
 *    its size. With several accounts stored, the browser sends all of them on
 *    every request, and an oversized `Cookie` header is a 431 the user cannot
 *    clear themselves. It also means a slot cookie holds no profile data at
 *    rest — one less copy of an email address on disk.
 */

/**
 * Three stored accounts, so four including the active one.
 *
 * Bounded on purpose, and the bound is a cookie-header budget rather than a
 * product opinion: every stored session rides on every single request to the
 * origin, and the common proxy limit is 8-16KB of total header. Four sessions
 * of ~1KB each (see `tokens-only` above) leaves comfortable room; unbounded
 * slots would eventually produce a 431 that looks like the site being down and
 * that the user has no way to fix. If this needs raising, measure a real
 * `Cookie` header first.
 */
export const MAX_STORED_ACCOUNTS = 3;

/** The slot numbers that exist. Fixed and small — see MAX_STORED_ACCOUNTS. */
export const STORED_ACCOUNT_SLOTS: readonly number[] = Array.from({ length: MAX_STORED_ACCOUNTS }, (_, i) => i);

const SLOT_COOKIE_PREFIX = "kivo-account-";

/** How many chunks one slot's session could occupy. `@supabase/ssr` chunks at
 *  3180 bytes; a tokens-only session is nowhere near that, but a chunked
 *  cookie left half-deleted is a corrupt session, so deletion sweeps wider
 *  than writing ever goes. */
const MAX_SLOT_CHUNKS = 5;

export function slotCookieName(slot: number): string {
  return `${SLOT_COOKIE_PREFIX}${slot}`;
}

/** Every cookie name a slot could be occupying: the base name plus its chunks. */
function slotCookieNames(slot: number): string[] {
  const base = slotCookieName(slot);
  return [base, ...Array.from({ length: MAX_SLOT_CHUNKS }, (_, i) => `${base}.${i}`)];
}

function isValidSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < MAX_STORED_ACCOUNTS;
}

/**
 * A slot's session, as the switcher sheet is allowed to see it.
 *
 * Deliberately carries no token of any kind. This crosses the server/client
 * boundary as a Server Action's return value, so anything in here is in the
 * page's RSC payload — the shape itself is the guarantee that a refresh token
 * cannot end up there by a later careless edit.
 */
export type StoredAccount = {
  slot: number;
  /** auth.users.id. Used only to spot the active account listed as a stale
   *  stash, never to look anything up on the client. */
  userId: string;
  /** From Supabase Auth, which owns it — KIVO's `profiles` never stores it. */
  email: string | null;
  /** `profiles.username`. Null only when the account has no profile row yet,
   *  which is a genuinely broken state, not a placeholder. */
  username: string | null;
  displayName: string | null;
  avatarSrc: string | null;
  /** Real total from the XP ledger (`get_xp_total`), read as this account
   *  itself. `null` means "could not be read" and MUST render as nothing —
   *  never as 0. A real 0 is a number and renders as one. */
  xp: number | null;
};

/** Tokens lifted out of one session so they can be put into another client.
 *  Never leaves the server. */
export type SessionTokens = {
  userId: string;
  accessToken: string;
  refreshToken: string;
};

function authConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * A Supabase client whose entire world is one slot cookie.
 *
 * `httpOnly`/`secure`/`sameSite`/`path` are set here rather than inherited,
 * because `@supabase/ssr`'s defaults are tuned for the active session that the
 * browser client has to be able to read (`httpOnly: false`). See decision 2 in
 * this file's header for why a stored slot goes the other way.
 *
 * `secure` follows the environment: on in production, off in local `next dev`
 * over plain http, where a `Secure` cookie would simply never be stored and
 * the feature would look broken for reasons no error message would explain.
 */
function createSlotClient(slot: number): SupabaseClient<Database> {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        name: slotCookieName(slot),
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      },
      cookies: {
        encode: "tokens-only",
        async getAll() {
          return (await cookies()).getAll();
        },
        async setAll(cookiesToSet) {
          try {
            const cookieStore = await cookies();
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch (error) {
            // Unlike the active client (src/lib/supabase/server.ts), a failure
            // here is NOT harmless and must not be swallowed silently. Every
            // caller in this module runs inside a Server Action, where cookies
            // are writable; if this ever fires it means a Server Component
            // reached one of these functions, and the rotated refresh token
            // that could not be written is a stored account about to vanish.
            logError("stored-accounts.setAll", error, {
              slot,
              detail: "Slot cookies are not writable in this context — call this only from a Server Action or Route Handler.",
            });
          }
        },
      },
    },
  );
}

/** Which slots currently hold something. Reads cookie names only — says
 *  nothing about whether the session in them is still valid. */
export async function occupiedSlots(): Promise<number[]> {
  const cookieStore = await cookies();
  return STORED_ACCOUNT_SLOTS.filter((slot) => {
    const base = slotCookieName(slot);
    return cookieStore.has(base) || cookieStore.has(`${base}.0`);
  });
}

/** The lowest empty slot, or null when all of them are taken. */
export async function findFreeSlot(): Promise<number | null> {
  const taken = new Set(await occupiedSlots());
  return STORED_ACCOUNT_SLOTS.find((slot) => !taken.has(slot)) ?? null;
}

/**
 * Forget a slot locally. Does NOT revoke anything — `signOutStoredSlot` is the
 * function that does, and it is what "Sign out" in the sheet calls. This one
 * exists for the cases where there is nothing left to revoke: a slot whose
 * session Supabase has already rejected, or the outgoing half of a switch.
 */
export async function clearSlot(slot: number): Promise<void> {
  if (!isValidSlot(slot)) return;
  const cookieStore = await cookies();
  for (const name of slotCookieNames(slot)) {
    if (cookieStore.has(name)) cookieStore.delete(name);
  }
}

/**
 * Put a session into a slot.
 *
 * `setSession` is what does the work: it validates the access token against
 * Supabase (or refreshes it when expired), then persists through this client's
 * storage, which is the slot cookie and nothing else. A session Supabase no
 * longer accepts fails here rather than being stored as a dud.
 */
export async function stashSessionInSlot(slot: number, tokens: SessionTokens): Promise<{ error: string | null }> {
  if (!isValidSlot(slot)) return { error: "That account slot doesn't exist." };
  if (!authConfigured()) return { error: "Sign-in isn't configured in this environment yet." };

  const client = createSlotClient(slot);
  const { error } = await client.auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });
  if (error) {
    logError("stored-accounts.stash", error, { slot });
    return { error: "That session could not be saved. Sign in again." };
  }
  return { error: null };
}

/**
 * Take the tokens out of a slot, leaving the slot as it is.
 *
 * `getSession()` rather than `getUser()` because the caller wants the tokens,
 * not an identity claim — and it refreshes on the way if the access token has
 * expired, so what comes back is usable immediately. The value is NOT trusted
 * as identity: the only thing done with it is handing it to `setSession` on
 * another client, which verifies it against Supabase before adopting it.
 */
export async function readSlotTokens(slot: number): Promise<SessionTokens | null> {
  if (!isValidSlot(slot) || !authConfigured()) return null;

  const client = createSlotClient(slot);
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token || !data.session.refresh_token) return null;
  return {
    userId: data.session.user?.id ?? "",
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  };
}

/**
 * Genuinely end a stored account's session, then forget it.
 *
 * `scope: "local"` terminates this session and only this session — the same
 * choice, for the same reason, as `signOut()` in
 * src/app/(app)/session-actions.ts: the person clicking "Sign out" next to one
 * account in a list means that account on this device, not every device they
 * own. The refresh token is destroyed server-side by that call; Supabase's own
 * documented limit applies unchanged (an access token already issued stays
 * valid until it expires, up to an hour), and it is not worth pretending
 * otherwise.
 *
 * The cookie is cleared whether or not the revocation succeeded, because the
 * alternative — a row the user tapped "Sign out" on that is still there
 * afterwards — is worse than a refresh token that outlives the click. The
 * failure is logged rather than hidden.
 */
export async function signOutStoredSlot(slot: number): Promise<{ error: string | null }> {
  if (!isValidSlot(slot)) return { error: "That account slot doesn't exist." };

  if (authConfigured()) {
    try {
      const client = createSlotClient(slot);
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) logError("stored-accounts.signOut", error, { slot });
    } catch (error) {
      logError("stored-accounts.signOut", error, { slot });
    }
  }

  await clearSlot(slot);
  return { error: null };
}

/**
 * Who is in a slot, resolved from Supabase rather than from the cookie.
 *
 * Three round trips, all as the stored account itself: `getUser()` to prove the
 * session is still live and learn the real user id, then that account's own
 * `profiles` row and its own XP total under its own RLS. Reading these as the
 * stored user rather than through the service-role client is the point — the
 * server never asserts an identity it has not just had Supabase confirm, so
 * there is no path where editing a cookie surfaces someone else's email.
 *
 * Returns null for a slot Supabase rejects, and clears it on the way out: a
 * session signed out elsewhere should disappear from the sheet, not sit there
 * as a row that fails when tapped.
 */
export async function readStoredAccount(slot: number): Promise<StoredAccount | null> {
  if (!isValidSlot(slot) || !authConfigured()) return null;

  const client = createSlotClient(slot);
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) {
    await clearSlot(slot);
    return null;
  }
  const user = userData.user;

  const { data: profile } = await client
    .from("profiles")
    .select("id, username, display_name, avatar_type, avatar_kivo_id, avatar_uploaded_url, avatar_url")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  // No profile row is a real, if rare, state — an account that has a Supabase
  // session but whose KIVO profile could not be created. Listed with what is
  // genuinely known (the email) rather than hidden, and with no invented
  // handle. src/components/auth/profile-unavailable.tsx is the screen that
  // explains it once they switch in.
  if (!profile) {
    return { slot, userId: user.id, email: user.email ?? null, username: null, displayName: null, avatarSrc: null, xp: null };
  }

  // Same aggregate every other XP surface uses (get_xp_total, migration 0023).
  // An error here yields null, which the sheet renders as nothing at all — a
  // confident "0 XP" for an account whose ledger we simply failed to read
  // would be a fabricated number.
  const { data: xp, error: xpError } = await client.rpc("get_xp_total", { p_profile_id: profile.id });

  return {
    slot,
    userId: user.id,
    email: user.email ?? null,
    username: profile.username,
    displayName: profile.display_name,
    avatarSrc: resolveAvatarSrc(profile),
    xp: xpError ? null : (xp ?? 0),
  };
}

/**
 * Every stored account, in slot order, minus any slot that turns out to hold
 * the account currently signed in.
 *
 * That last part is what makes an abandoned "Add account" harmless. The add
 * flow does not stash anything until a new session actually arrives, but a
 * switch interrupted at exactly the wrong moment, or an account signed into
 * twice, could still leave the active user duplicated in a slot. Rather than
 * show the same person twice, the duplicate slot is cleared — the active
 * session is the copy that matters and it is untouched.
 */
export async function listStoredAccounts(activeUserId: string | null): Promise<StoredAccount[]> {
  const slots = await occupiedSlots();
  const accounts: StoredAccount[] = [];

  // Sequential rather than Promise.all: these all write to the same cookie
  // store (a refresh here, a cleared dead slot there), and Next's cookie store
  // is not something to race several writers against for the sake of saving a
  // few hundred milliseconds on a list that is at most three long.
  for (const slot of slots) {
    const account = await readStoredAccount(slot);
    if (!account) continue;
    if (activeUserId && account.userId === activeUserId) {
      await clearSlot(slot);
      continue;
    }
    accounts.push(account);
  }

  return accounts;
}
