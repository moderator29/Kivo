"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { AuthError } from "@supabase/supabase-js";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "./supabase/server";
import { resolveViewerProfile } from "./profile";
import { isAuthConfigured, sanitizeRedirectPath } from "./auth";
import { checkRateLimit, getClientIp } from "./rate-limit";
import { trustedOriginFor } from "./site-url";
import { COUNTRY_CODES } from "./countries";
import {
  EMAIL_PATTERN,
  FULL_NAME_MAX,
  FULL_NAME_MIN,
  RESEND_COOLDOWN_SECONDS,
  USERNAME_PATTERN,
  describePasswordProblem,
  normalizeEmail,
  normalizeUsername,
  type AuthActionResult,
  type AuthMode,
  type SignUpInput,
  type UsernameAvailability,
} from "./auth-shared";
import { MAX_STORED_ACCOUNTS, findFreeSlot, stashSessionInSlot, type SessionTokens } from "./supabase/stored-accounts";
import { logError } from "@/lib/log";

/**
 * Server Actions behind every KIVO auth screen: sign-up (src/components/auth/
 * sign-up-form.tsx), sign-in (sign-in-form.tsx), the email-code alternative
 * (email-code-form.tsx) and password reset (forgot-password-form.tsx,
 * reset-password-form.tsx).
 *
 * Why Server Actions and not the browser client: `@supabase/ssr`'s server
 * client writes the session cookies through Next's cookie store, which is the
 * one place that can set them for BOTH this response and every subsequent
 * request in the same navigation. Verifying the code here means the redirect
 * that follows is already authenticated — which is precisely the production bug
 * this design exists to fix (a completed sign-up that landed back on the
 * marketing page instead of inside the product).
 *
 * THE RULE THIS FILE IS BUILT ON. Every one of these functions is a public POST
 * endpoint the moment it ships (see Next 16's Server Actions guide, "Security":
 * the implementation stays on the server but the route is reachable by anyone
 * who can send the same request). So the client copy of a rule is convenience
 * and this file is the boundary: every field is re-validated here from scratch,
 * and no argument is ever trusted to say WHO the caller is — identity comes
 * from the session, via resolveViewerProfile().
 */

/**
 * Turn a Supabase AuthError into something a human can act on. Supabase's raw
 * messages are developer-facing ("Signups not allowed for otp"), so every case
 * we can actually anticipate gets a real KIVO sentence; anything unanticipated
 * falls through to a generic line rather than leaking internals.
 */
function describeAuthError(error: AuthError, mode: AuthMode): AuthActionResult {
  const code = error.code ?? "";
  const message = error.message ?? "";

  switch (code) {
    case "otp_expired":
      return { error: "That code has expired. Request a new one." };
    case "otp_disabled":
      // signInWithOtp with shouldCreateUser: false and no such user. NOT
      // surfaced to the caller — see the enumeration note on sendEmailCode.
      // This case is intercepted there and never reaches this function; the
      // branch stays for the sign-up mode, where the same code means the
      // project has OTP turned off entirely rather than "no such user".
      return { error: "Email sign-in is turned off for this environment." };
    case "signup_disabled":
      return { error: "New sign-ups are turned off right now. Try again later." };
    case "email_address_invalid":
    case "validation_failed":
      return { error: "That doesn't look like a valid email address.", field: "email" };
    case "email_address_not_authorized":
      return { error: "That email address isn't allowed to sign in to this environment.", field: "email" };
    case "user_banned":
      // KN-118: "contact support" now names a route that exists. Referred to
      // by the on-page link rather than an absolute URL — KIVO's production
      // domain is not decided in this repository and must not be invented here.
      return { error: "This account has been suspended. If you think that's wrong, use the Get help link below." };

    // ---- password-era codes -------------------------------------------------
    case "invalid_credentials":
      // Deliberately one message for "no such account" and "wrong password".
      // Distinguishing them is the same membership oracle /sign-in already
      // refuses to be (DECISIONS.md, "Sign-in no longer confirms whether an
      // email address has a KIVO account"). The second sentence is the real
      // next step for the one case a returning KIVO user is most likely to hit:
      // an account made before passwords existed, which has no password at all.
      return {
        error: "Wrong email or password. If you've never set a password, use Forgot password below.",
        field: "password",
      };
    case "weak_password":
      // Supabase's own strength check (project-level, including the leaked-
      // password list once it is switched on) refusing a password that passed
      // ours. Pass its reason through — it names something ours cannot know.
      return {
        error: /pwned|leaked|compromis/i.test(message)
          ? "That password has appeared in a known data breach. Choose a different one."
          : "That password isn't strong enough. Choose a longer, less common one.",
        field: "password",
      };
    case "same_password":
      return { error: "That's already your password. Choose a different one.", field: "password" };
    case "email_exists":
    case "user_already_exists":
      // Reached only when the project has email confirmation switched OFF; with
      // it on, Supabase obfuscates this case itself. See signUpWithPassword.
      return { error: "Check your email — if that address has a KIVO account, sign in instead.", field: "email" };
    case "session_not_found":
    case "refresh_token_not_found":
      return { error: "That reset link or code has expired. Request a new one." };

    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return {
        error: "Too many requests. Wait a moment before trying again.",
        retryAfterSeconds: secondsFromRateLimitMessage(message) ?? RESEND_COOLDOWN_SECONDS,
      };
  }

  // Supabase doesn't always populate `code` (older gateway responses, and the
  // generic 403 on a wrong token), so fall back to status + message shape.
  if (error.status === 429) {
    return {
      error: "Too many attempts. Wait a moment before trying again.",
      retryAfterSeconds: secondsFromRateLimitMessage(message) ?? RESEND_COOLDOWN_SECONDS,
    };
  }
  if (/expired or is invalid/i.test(message)) {
    return { error: "That code is wrong or has expired. Check it and try again." };
  }

  logError("auth-actions.supabaseAuth", { code, status: error.status, message }, { detail: `Supabase auth ${mode} failed` });
  return { error: "Something went wrong on our side. Try again in a moment." };
}

/** Supabase phrases its per-email throttle as "you can only request this after
 *  N seconds"; surface that exact number so the form's countdown is honest. */
function secondsFromRateLimitMessage(message: string): number | undefined {
  const match = /after (\d+) seconds?/i.exec(message);
  return match ? Number(match[1]) : undefined;
}

/**
 * Server-side throttling for the endpoints anyone on the internet can hit
 * without an account.
 *
 * These are not ordinary actions. Three separate abuses are in scope and they
 * need different budgets:
 *
 *  - **Sending mail as KIVO.** `sendEmailCode`, `signUpWithPassword` and
 *    `requestPasswordReset` all make KIVO's own domain send mail to an address
 *    the caller chose. Unthrottled that is a cost problem, a sending-reputation
 *    problem (a burst of abuse can get the domain blocked, which breaks sign-up
 *    for everybody), and — for reset specifically — a way to mail somebody
 *    else's inbox repeatedly on their behalf.
 *  - **Guessing a six-digit code.** `verifyEmailCode` and the reset verify are
 *    one-in-a-million oracles; Supabase throttles *sending*, not verifying.
 *  - **Guessing a password.** New with this release, and the reason the
 *    numbers below are not simply copied from the OTP ones: a password endpoint
 *    is the credential-stuffing target in any product that has one. The per-IP
 *    budget matters more than the per-email one here, because stuffing sprays
 *    one guess each across thousands of leaked addresses rather than hammering
 *    one of them.
 *
 * The form's own resend cooldown is a courtesy to honest users and nothing
 * more: it lives in the browser and is trivially bypassed by posting directly.
 *
 * Two keys per call, deliberately. The email key stops one address being
 * hammered (or mail-bombed) no matter where the requests come from; the IP key
 * stops one attacker cycling through many addresses. Either alone leaves an
 * obvious hole.
 */
async function throttle(action: string, address: string, perEmail: number, perIp: number, windowSeconds: number) {
  const byEmail = await checkRateLimit(`email:${address}`, action, perEmail, windowSeconds);
  if (!byEmail.ok) return byEmail;
  return checkRateLimit(`ip:${await getClientIp()}`, action, perIp, windowSeconds);
}

/**
 * checkRateLimit() needs the service-role key (rate_limit_events has no
 * client-facing RLS policy by design), and createServiceRoleSupabaseClient()
 * throws outright when that key is absent — which is the normal state of a
 * local dev environment configured with only the public keys. Swallowing that
 * one case keeps `next dev` usable while leaving every real limit intact
 * wherever the key IS set, and it is consistent with checkRateLimit's own
 * documented "fail open on infra errors, fail closed on over-limit" stance.
 * Logged loudly rather than silently, because a deployed environment missing
 * this key means these endpoints are running unthrottled.
 */
async function throttleOrPassThrough(
  action: string,
  address: string,
  perEmail: number,
  perIp: number,
  windowSeconds: number,
): Promise<AuthActionResult | undefined> {
  try {
    const result = await throttle(action, address, perEmail, perIp, windowSeconds);
    if (!result.ok) return { error: result.error, retryAfterSeconds: windowSeconds };
  } catch (error) {
    logError("auth-actions.rateLimitingIsNot", error, { detail: `Rate limiting is NOT active for ${action} — SUPABASE_SERVICE_ROLE_KEY is missing or invalid. ` +
        "This endpoint is unthrottled until that is fixed." });
  }
  return undefined;
}

/** IP-only throttle, for the one endpoint with no email attached to key on. */
async function throttleByIpOnly(action: string, perIp: number, windowSeconds: number): Promise<boolean> {
  try {
    const result = await checkRateLimit(`ip:${await getClientIp()}`, action, perIp, windowSeconds);
    return result.ok;
  } catch (error) {
    logError("auth-actions.ipThrottleUnavailable", error, { detail: `Rate limiting is NOT active for ${action}.` });
    return true;
  }
}

// ---------------------------------------------------------------------------
// Username availability
// ---------------------------------------------------------------------------

/**
 * Is this handle free? Asked live as the user types on /sign-up, and again by
 * signUpWithPassword before it creates anything.
 *
 * Uses the `is_username_available(p_username, p_exclude_profile_id)`
 * SECURITY DEFINER RPC that already exists (the same one Settings and the
 * onboarding flow call) rather than a second implementation of the same
 * question. `profiles` has no cross-user SELECT policy, so a plain query cannot
 * answer this.
 *
 * Through the SERVICE-ROLE client, deliberately. The RPC is granted to
 * `authenticated` and `service_role` only, and the caller here is by definition
 * signed OUT — they are creating an account. The alternative, granting EXECUTE
 * to `anon`, would publish `/rest/v1/rpc/is_username_available` as an
 * unauthenticated endpoint anyone could enumerate KIVO's whole user list
 * through, at Supabase's rate limits rather than ours. Going through this
 * action instead keeps the question behind KIVO's own throttle and adds no
 * public API surface, at the cost of needing SUPABASE_SERVICE_ROLE_KEY — which
 * a deployed KIVO already requires (docs/DEPLOYING.md step 1).
 *
 * Returns `available: null` for "can't tell" — a bad candidate, a missing
 * service-role key, a throttled caller, or a failed check — which is a
 * genuinely different state from "taken" and the UI must render it as silence,
 * never as a guess. The real boundary is not this function in any case: it is
 * the UNIQUE constraint on `profiles.username`, checked again at the moment the
 * row is actually written.
 */
export async function checkUsernameAvailability(username: string): Promise<UsernameAvailability> {
  const candidate = normalizeUsername(username);
  if (!USERNAME_PATTERN.test(candidate)) return { available: null };

  // Keyed on IP alone — there is no account yet to key on. Generous, because
  // this fires from a debounced keystroke handler and a person picking a handle
  // legitimately tries a dozen: 60 in five minutes is far past honest use and
  // far below useful enumeration.
  if (!(await throttleByIpOnly("auth_check_username", 60, 5 * 60))) {
    return { available: null };
  }

  let supabase: ReturnType<typeof createServiceRoleSupabaseClient>;
  try {
    supabase = createServiceRoleSupabaseClient();
  } catch (error) {
    logError("auth-actions.usernameCheckUnavailable", error, {
      detail: "Username availability cannot be checked — SUPABASE_SERVICE_ROLE_KEY is missing. " +
        "The unique constraint on profiles.username is still enforced at account creation.",
    });
    return { available: null };
  }

  const { data, error } = await supabase.rpc("is_username_available", {
    p_username: candidate,
    p_exclude_profile_id: undefined,
  });

  if (error) {
    logError("auth-actions.checkUsernameAvailability", error);
    return { available: null };
  }
  return { available: data };
}

// ---------------------------------------------------------------------------
// Sign-up: one pre-verification form, then a code
// ---------------------------------------------------------------------------

/**
 * Everything KIVO needs about a person, collected BEFORE the account exists.
 *
 * This is the shape the founder asked for, and the reason it is worth the extra
 * code: identity used to be collected after verification, in onboarding, which
 * meant a half-made account existed in `auth.users` for every abandoned signup
 * and the handle a user picked could be taken by somebody else in the gap. Now
 * the account is only created once the full identity is valid, and the identity
 * travels to Supabase as user metadata so it survives the verification round
 * trip without KIVO having to hold server-side state between two requests.
 *
 * Where each field lands, once verified (see resolveViewerProfile in
 * src/lib/profile.ts, which is the single place a profile row is ever created):
 *   fullName -> profiles.display_name   username -> profiles.username
 *   country  -> profiles.country (ISO 3166-1 alpha-2, never a display string)
 *
 * ON ENUMERATION. With Confirm-email switched on, `signUp` for an address that
 * already has a confirmed account does NOT error: Supabase returns an
 * obfuscated user with an empty `identities` array and sends nothing. We keep
 * that obfuscation instead of detecting it and saying so, because /sign-in
 * already refuses to answer "does this address have a KIVO account?"
 * (DECISIONS.md) and answering it here would simply move the oracle one page
 * across. The cost is a user who signs up twice waiting for a code that will
 * not come; it is paid for on the code screen, which carries a permanent,
 * unconditional "already have an account? sign in instead" line — shown to
 * everybody, so it reveals nothing.
 */
export async function signUpWithPassword(input: SignUpInput, redirectTo?: string): Promise<AuthActionResult | undefined> {
  if (!isAuthConfigured()) {
    return { error: "Sign-up isn't configured in this environment yet." };
  }

  // --- every rule, re-run here, on data that arrived over the wire ----------
  const email = normalizeEmail(String(input?.email ?? ""));
  if (!EMAIL_PATTERN.test(email)) {
    return { error: "Enter a valid email address.", field: "email" };
  }

  const fullName = String(input?.fullName ?? "").trim().replace(/\s+/g, " ");
  if (fullName.length < FULL_NAME_MIN || fullName.length > FULL_NAME_MAX) {
    return { error: `Enter your full name (up to ${FULL_NAME_MAX} characters).`, field: "fullName" };
  }

  const username = normalizeUsername(String(input?.username ?? ""));
  if (!USERNAME_PATTERN.test(username)) {
    return {
      error: "Username must be 3-24 characters: lowercase letters, numbers and underscores only.",
      field: "username",
    };
  }

  const password = String(input?.password ?? "");
  const passwordProblem = describePasswordProblem(password);
  if (passwordProblem) return { error: passwordProblem, field: "password" };

  if (password !== String(input?.confirmPassword ?? "")) {
    return { error: "Both passwords must match.", field: "confirmPassword" };
  }

  const country = String(input?.country ?? "").trim().toUpperCase();
  if (!(COUNTRY_CODES as readonly string[]).includes(country)) {
    return { error: "Choose your country from the list.", field: "country" };
  }

  // The agreement is a real gate, not a decoration. It is checked here because
  // a checkbox is trivially omitted from a hand-made POST, and consent that can
  // be skipped by not sending a field is not consent.
  if (input?.agreed !== true) {
    return { error: "You need to agree to the Privacy Policy and Terms to create an account.", field: "agreed" };
  }

  // Same budget as any other endpoint that makes KIVO send mail: three per
  // address and ten per IP per fifteen minutes. Applied BEFORE the username
  // check so a caller cannot use signup as an unlimited enumeration endpoint.
  const throttled = await throttleOrPassThrough("auth_sign_up", email, 3, 10, 15 * 60);
  if (throttled) return throttled;

  // Checked again server-side. A `null` answer here means the check itself
  // could not run, and that must not block a signup — the UNIQUE constraint on
  // profiles.username is the actual boundary and it is checked when the row is
  // written. Only a definite "taken" stops us.
  const { available } = await checkUsernameAvailability(username);
  if (available === false) {
    return { error: "That username is taken. Try another.", field: "username" };
  }

  const next = sanitizeRedirectPath(redirectTo);
  const callback = new URL("/auth/callback", await requestOrigin());
  if (next) callback.searchParams.set("next", next);

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Read back by resolveViewerProfile() when it provisions the row, and
      // re-validated there — user metadata is writable by the user themselves
      // via updateUser({ data }), so it is an input, not a fact.
      data: { full_name: fullName, username, country },
      emailRedirectTo: callback.toString(),
    },
  });

  if (error) return describeAuthError(error, "sign-up");
  return undefined;
}

/**
 * Absolute origin for the one thing that genuinely needs one: the link Supabase
 * embeds in the email, which is opened from a mail client with no relation to
 * this request.
 *
 * KN-125. This used to read `x-forwarded-host` and use it directly whenever
 * NEXT_PUBLIC_APP_URL was unset — a header the caller sets, turned into the URL
 * that goes out in mail sent from KIVO's own domain. Supabase re-validates
 * `emailRedirectTo` against the project's redirect allow-list, and that IS the
 * real mitigation, but that allow-list is dashboard configuration which appears
 * nowhere in this repository: nothing in here proves it is set, so nothing in
 * here may depend on it.
 *
 * The request host is still consulted, because discarding it outright breaks
 * preview deployments (the PKCE verifier cookie was set on the preview host, so
 * a link pointing at production cannot complete there). It is now *checked*
 * first — `trustedOriginFor` accepts it only when it matches an origin this
 * deployment is configured to answer on, and otherwise returns the canonical
 * site URL. Every entry in that allow-list comes from server-side environment,
 * never from the request.
 */
async function requestOrigin(): Promise<string> {
  const headerList = await headers();
  return trustedOriginFor(
    headerList.get("x-forwarded-host") ?? headerList.get("host"),
    headerList.get("x-forwarded-proto"),
  );
}

// ---------------------------------------------------------------------------
// Adding a second account, shared by every path that can establish a session
// ---------------------------------------------------------------------------

type OutgoingSession = { slot: number; tokens: SessionTokens };

/**
 * ADDING an account rather than replacing one. Everything here happens BEFORE
 * the new session is established, on purpose: if there is nowhere to put the
 * outgoing session, the user is told now, while their account is still signed
 * in and their credential is still unused — rather than after the sign-in has
 * already replaced the session cookie and taken the decision away.
 *
 * Only ever reached when the caller passed `addAccount`, which only the in-app
 * "Add account" entry point does. An ordinary sign-in on a device where
 * somebody else's session is still sitting in the cookie keeps its old
 * behaviour — that session is replaced and NOT quietly kept alive in a slot,
 * which on a shared phone is the safer of the two.
 */
async function reserveSlotForOutgoingSession(): Promise<{ outgoing: OutgoingSession | null; error?: AuthActionResult }> {
  const supabase = createServerSupabaseClient();
  const { data: existing } = await supabase.auth.getSession();
  if (!existing.session?.access_token || !existing.session.refresh_token) {
    return { outgoing: null };
  }
  const slot = await findFreeSlot();
  if (slot === null) {
    return {
      outgoing: null,
      error: { error: `You can keep ${MAX_STORED_ACCOUNTS + 1} accounts on this device. Sign one out before adding another.` },
    };
  }
  return {
    outgoing: {
      slot,
      tokens: {
        userId: existing.session.user?.id ?? "",
        accessToken: existing.session.access_token,
        refreshToken: existing.session.refresh_token,
      },
    },
  };
}

/** Park the session the new one replaced, so the switcher can get back to it —
 *  unless the user just signed in as the account they were already using, in
 *  which case there is nothing to keep and storing it would list the same
 *  person twice. */
async function keepReplacedSession(outgoing: OutgoingSession | null, newUserId: string | undefined) {
  if (!outgoing || !newUserId || outgoing.tokens.userId === newUserId) return;
  const kept = await stashSessionInSlot(outgoing.slot, outgoing.tokens);
  if (kept.error) {
    // Not fatal — the account they asked for IS signed in — but the previous
    // one is now unreachable from this device, which they will notice.
    logError("auth-actions.stashPreviousAccount", kept.error, {
      detail: "Added an account, but the previous session could not be kept for switching.",
    });
  }
}

/**
 * The one place a freshly authenticated request decides where the person lands.
 *
 * Decided here rather than left to the client so that a brand-new signee cannot
 * end up anywhere except onboarding, and a returning user cannot be talked into
 * a destination they didn't ask for (`sanitizeRedirectPath` re-validates the
 * path server-side even though the page already validated it — the client
 * controls what it posts back).
 *
 * Never returns on success: it redirects, so the browser follows with the
 * session cookie already written. A returned value is always a failure.
 */
async function landAfterAuthentication(redirectTo: string | undefined, addAccount: boolean): Promise<AuthActionResult> {
  // A different person is now rendering every server component in this app.
  // Next 16 documents `revalidatePath("/", "layout")` as purging the Client
  // Cache and invalidating all cached data, which is what keeps a page the
  // previous account rendered from being handed to this one on a back
  // navigation. Only on the add path: an ordinary sign-in has no earlier
  // signed-in account whose payloads could still be in the cache.
  if (addAccount) revalidatePath("/", "layout");

  // The session cookies are written by now, and createServerSupabaseClient() is
  // request-cached, so this call already runs as the freshly signed-in user —
  // creating their profile row on the spot if this is their first visit.
  const viewer = await resolveViewerProfile();

  // Signed in, but the profile row could not be read or created. Reported in
  // place rather than redirected: sending them into (app) would render the
  // terminal ProfileUnavailable screen a navigation later, and telling them
  // right here — on the form they are already looking at — is faster and
  // clearer.
  if (viewer.status !== "ready") {
    return { error: "You're signed in, but your KIVO profile couldn't be set up. Try again." };
  }

  // redirect() throws NEXT_REDIRECT, so it must stay outside any try/catch.
  if (!viewer.profile.onboarding_completed) redirect("/onboarding");
  redirect(sanitizeRedirectPath(redirectTo) ?? "/home");
}

// ---------------------------------------------------------------------------
// Sign-in with a password
// ---------------------------------------------------------------------------

/**
 * The front door.
 *
 * Note what is NOT here: no check of whether the address exists before trying
 * the password, and no different message when it doesn't. `invalid_credentials`
 * covers both cases with one sentence (see describeAuthError), which is the
 * only way a password form can avoid being the membership oracle that
 * /sign-in's code path was deliberately stopped from being.
 */
export async function signInWithPassword(
  email: string,
  password: string,
  redirectTo?: string,
  addAccount?: boolean,
): Promise<AuthActionResult | undefined> {
  if (!isAuthConfigured()) {
    return { error: "Sign-in isn't configured in this environment yet." };
  }

  const address = normalizeEmail(email);
  if (!EMAIL_PATTERN.test(address)) {
    return { error: "Enter a valid email address.", field: "email" };
  }
  if (password.length === 0) {
    return { error: "Enter your password.", field: "password" };
  }

  // Ten guesses per address per fifteen minutes is far past a person mistyping
  // a password they know, and 40 per IP is the number that actually bites a
  // credential-stuffing run — those spray one guess each across many addresses,
  // so the per-address budget alone would never fire.
  const throttled = await throttleOrPassThrough("auth_password_sign_in", address, 10, 40, 15 * 60);
  if (throttled) return throttled;

  let outgoing: OutgoingSession | null = null;
  if (addAccount) {
    const reserved = await reserveSlotForOutgoingSession();
    if (reserved.error) return reserved.error;
    outgoing = reserved.outgoing;
  }

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: address, password });
  if (error) return describeAuthError(error, "sign-in");

  await keepReplacedSession(outgoing, data.user?.id);
  return landAfterAuthentication(redirectTo, Boolean(addAccount));
}

// ---------------------------------------------------------------------------
// The email-code path — kept, on purpose. See DECISIONS.md.
// ---------------------------------------------------------------------------

/**
 * Step 1 of the code path: email a six-digit code.
 *
 * WHY THIS STILL EXISTS now that passwords do. It is the second door, and it is
 * kept for two reasons that are about this deployment specifically, not about
 * liking options:
 *
 *  1. Every account that existed before passwords shipped was created without
 *     one, including the only real account on the platform. Removing the code
 *     path on the same night passwords arrive would make that person's ability
 *     to sign in depend entirely on a reset email arriving. Two doors is
 *     strictly safer than one when the cost of being wrong is the founder
 *     locked out of their own product.
 *  2. It is the recovery path for anybody whose password is simply gone, on a
 *     platform whose support surface is one page.
 *
 * It is deliberately SECONDARY: /sign-in shows the password form first and this
 * behind an explicit "Email me a code instead" control. Both go through this
 * one file, both are rate-limited by the same helper, and both are covered by
 * the same tests — the failure mode the founder's brief warns about is two
 * *half-maintained* paths, not two paths.
 *
 * `shouldCreateUser` is false on every call now. Sign-up is the password form,
 * so this path can no longer bring an account into existence — an unknown
 * address gets the same silent treatment as a known one.
 *
 * WHICH EMAIL SUPABASE ACTUALLY SENDS — read this before changing anything here.
 * For an existing address `signInWithOtp` sends **Magic Link**; the template
 * must contain `{{ .Token }}` or the user receives a link with no code in it
 * while this form waits for a code that was never sent.
 * docs/email-templates/README.md carries the templates and the dashboard steps.
 *
 * `emailRedirectTo` is the safety net for that being got wrong: it points the
 * link at /auth/callback, which signs the user in and lands them in the same
 * place the code path would.
 */
export async function sendEmailCode(
  email: string,
  mode: AuthMode,
  redirectTo?: string,
): Promise<AuthActionResult | undefined> {
  if (!isAuthConfigured()) {
    return { error: "Sign-in isn't configured in this environment yet." };
  }

  const address = normalizeEmail(email);
  if (!EMAIL_PATTERN.test(address)) {
    return { error: "Enter a valid email address.", field: "email" };
  }

  // Three codes per address per 15 minutes is well clear of a real person
  // mistyping their email once and resending once; 10 per IP per 15 minutes
  // still allows a shared office NAT while shutting down bulk abuse.
  const throttled = await throttleOrPassThrough("auth_send_email_code", address, 3, 10, 15 * 60);
  if (throttled) return throttled;

  const next = sanitizeRedirectPath(redirectTo);
  const callback = new URL("/auth/callback", await requestOrigin());
  if (next) callback.searchParams.set("next", next);

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: address,
    // Never brings an account into existence any more: /sign-up owns account
    // creation, and it needs a username, a country and an agreement this form
    // does not collect. An address with no account gets a silent no-op.
    options: { shouldCreateUser: false, emailRedirectTo: callback.toString() },
  });

  // KN-124: never answer "does this email have a KIVO account?".
  //
  // `shouldCreateUser: false` makes Supabase return `otp_disabled` for an
  // address that has never signed up. Reporting that back — which this used to,
  // as "No KIVO account uses that email yet" — is a membership oracle: anyone
  // can feed addresses in one at a time and learn who is on KIVO. The throttle
  // above makes that slow, not impossible, and a slow leak of a user list is
  // still a leak.
  //
  // So this answers identically whether or not the account exists: the form
  // advances to the code step either way. The UX that message existed to
  // provide is preserved without the oracle — the code screen carries a
  // permanent, unconditional "no code? you may not have an account yet, create
  // one" line, which is exactly the next action the old message prompted, shown
  // to everybody instead of only to the people whose absence we just confirmed.
  if (error) {
    if (error.code === "otp_disabled") return undefined;
    return describeAuthError(error, mode);
  }
  return undefined;
}

/**
 * Step 2 of the code path, and also step 2 of sign-up: exchange the code for a
 * session, then land the user INSIDE the app.
 *
 * One function for both because it is genuinely one operation — GoTrue's
 * `type: "email"` verification tries the signup token and then the magic-link
 * token, so a code minted by `signUp` and a code minted by `signInWithOtp` are
 * both redeemed here. Splitting them would have produced two near-identical
 * functions differing in a string.
 */
export async function verifyEmailCode(
  email: string,
  code: string,
  redirectTo?: string,
  addAccount?: boolean,
): Promise<AuthActionResult | undefined> {
  if (!isAuthConfigured()) {
    return { error: "Sign-in isn't configured in this environment yet." };
  }

  const address = normalizeEmail(email);
  const token = code.replace(/\D/g, "");
  if (token.length !== 6) {
    return { error: "Enter the 6-digit code from your email." };
  }

  // Brute-force guard: a six-digit code is one in a million, and this caps a
  // single address at 8 guesses per 15 minutes (and one IP at 20 across all
  // addresses). Supabase expires the code long before that budget could matter,
  // but the limit has to exist here too — Supabase's own throttle is on sending,
  // not on verifying.
  const throttled = await throttleOrPassThrough("auth_verify_email_code", address, 8, 20, 15 * 60);
  if (throttled) return throttled;

  let outgoing: OutgoingSession | null = null;
  if (addAccount) {
    const reserved = await reserveSlotForOutgoingSession();
    if (reserved.error) return reserved.error;
    outgoing = reserved.outgoing;
  }

  const supabase = createServerSupabaseClient();
  const { data: verified, error } = await supabase.auth.verifyOtp({ email: address, token, type: "email" });
  if (error) return describeAuthError(error, "sign-in");

  await keepReplacedSession(outgoing, verified.user?.id);
  return landAfterAuthentication(redirectTo, Boolean(addAccount));
}

// ---------------------------------------------------------------------------
// Forgotten password
// ---------------------------------------------------------------------------

/**
 * Step 1 of reset: mail a recovery code.
 *
 * **This function answers the same way whether or not the address has an
 * account.** It always returns `undefined`, and the form always advances to the
 * code screen. That is a hard requirement, not a preference: a reset form that
 * says "no account with that email" is the cleanest membership oracle a product
 * can ship, and it is the one place users are most likely to type somebody
 * else's address. Supabase's `resetPasswordForEmail` already returns success
 * for an unknown address, and the only errors we let through are ones about the
 * *request* (throttling, a malformed address) rather than about the account.
 *
 * A CODE, not just a link. `resetPasswordForEmail` sends the **Reset Password**
 * template, which carries both `{{ .Token }}` and `{{ .ConfirmationURL }}`
 * (docs/email-templates/reset-password.html). KIVO leads with the code because
 * the link half is PKCE: the code verifier is a cookie on the browser that
 * *asked* for the reset, so a link opened on a different device cannot complete
 * — which on a phone-first product is a real dead end, not a rare one. The
 * typed code has no such constraint. The link still works from the same browser
 * and lands on /auth/callback, which is the safety net if the code half of the
 * template is ever mis-installed.
 */
export async function requestPasswordReset(email: string): Promise<AuthActionResult | undefined> {
  if (!isAuthConfigured()) {
    return { error: "Password reset isn't configured in this environment yet." };
  }

  const address = normalizeEmail(email);
  if (!EMAIL_PATTERN.test(address)) {
    return { error: "Enter a valid email address.", field: "email" };
  }

  // Tighter and longer-windowed than sign-in: this endpoint sends mail to an
  // address the caller chose and did not have to prove they own, so it is the
  // one that can be turned into a mail-bomb against a third party. Three per
  // address per hour, ten per IP.
  const throttled = await throttleOrPassThrough("auth_password_reset", address, 3, 10, 60 * 60);
  if (throttled) return throttled;

  const callback = new URL("/auth/callback", await requestOrigin());
  callback.searchParams.set("next", "/reset-password");

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.auth.resetPasswordForEmail(address, { redirectTo: callback.toString() });

  if (error) {
    // Only request-level failures are reportable. Anything that could be read
    // as "that account does not exist" is swallowed, and the caller advances to
    // the code screen exactly as a real account would.
    if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
      return describeAuthError(error, "sign-in");
    }
    logError("auth-actions.requestPasswordReset", { code: error.code, status: error.status });
  }
  return undefined;
}

/**
 * Step 2 of reset: redeem the recovery code and set the new password in one go.
 *
 * Deliberately one action rather than "verify, then a second screen": between
 * the two there would be a live recovery session sitting in a cookie that can
 * change a password, and the shorter that window is the better. The user types
 * the code and their new password on the same screen, and this either does both
 * or neither.
 *
 * The password is re-validated here against the same rules the form showed,
 * because the form is convenience and this is the boundary. Nothing about WHO
 * is being changed comes from the arguments — the recovery session established
 * by verifyOtp is what `updateUser` acts on, so a caller cannot name somebody
 * else's account.
 */
export async function resetPasswordWithCode(
  email: string,
  code: string,
  password: string,
  confirmPassword: string,
): Promise<AuthActionResult | undefined> {
  if (!isAuthConfigured()) {
    return { error: "Password reset isn't configured in this environment yet." };
  }

  const address = normalizeEmail(email);
  const token = code.replace(/\D/g, "");
  if (token.length !== 6) {
    return { error: "Enter the 6-digit code from your email." };
  }

  const passwordProblem = describePasswordProblem(password);
  if (passwordProblem) return { error: passwordProblem, field: "password" };
  if (password !== confirmPassword) {
    return { error: "Both passwords must match.", field: "confirmPassword" };
  }

  const throttled = await throttleOrPassThrough("auth_verify_password_reset", address, 8, 20, 15 * 60);
  if (throttled) return throttled;

  const supabase = createServerSupabaseClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({ email: address, token, type: "recovery" });
  if (verifyError) return describeAuthError(verifyError, "sign-in");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return describeAuthError(error, "sign-in");

  // Signed in as the account whose password was just changed — no second
  // sign-in step, because they have already proved control of the mailbox and
  // chosen a credential. landAfterAuthentication() redirects on success, so
  // anything it returns is a failure worth showing on this form.
  return landAfterAuthentication(undefined, false);
}

/**
 * The link half of reset: /reset-password renders a bare password form for a
 * browser that already holds a recovery session (Supabase's emailed link ->
 * /auth/callback -> here). Same validation, same boundary; the session is the
 * only thing that says whose password this is.
 *
 * Refuses outright when there is no session rather than pretending: an expired
 * or already-used link must say so, not silently do nothing.
 */
export async function updatePasswordForRecoverySession(
  password: string,
  confirmPassword: string,
): Promise<AuthActionResult | undefined> {
  if (!isAuthConfigured()) {
    return { error: "Password reset isn't configured in this environment yet." };
  }

  const passwordProblem = describePasswordProblem(password);
  if (passwordProblem) return { error: passwordProblem, field: "password" };
  if (password !== confirmPassword) {
    return { error: "Both passwords must match.", field: "confirmPassword" };
  }

  if (!(await throttleByIpOnly("auth_update_password", 20, 15 * 60))) {
    return { error: "Too many attempts. Wait a moment before trying again.", retryAfterSeconds: 15 * 60 };
  }

  const supabase = createServerSupabaseClient();
  // Verified against the project's JWKS, not read from the cookie's contents.
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return { error: "That reset link has expired or was already used. Request a new one." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return describeAuthError(error, "sign-in");

  return landAfterAuthentication(undefined, false);
}

// Signing OUT lives in src/app/(app)/session-actions.ts, alongside the
// "sign out other devices" control it shares a mental model with.
