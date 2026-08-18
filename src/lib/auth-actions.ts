"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { AuthError } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "./supabase/server";
import { resolveViewerProfile } from "./profile";
import { isAuthConfigured, sanitizeRedirectPath } from "./auth";
import { checkRateLimit, getClientIp } from "./rate-limit";
import { RESEND_COOLDOWN_SECONDS, type AuthActionResult, type AuthMode } from "./auth-shared";

/**
 * Server Actions behind the KIVO email sign-in / sign-up form
 * (src/components/auth/email-code-form.tsx).
 *
 * Why Server Actions and not the browser client: `@supabase/ssr`'s server
 * client writes the session cookies through Next's cookie store, which is the
 * one place that can set them for BOTH this response and every subsequent
 * request in the same navigation. Verifying the code here means the redirect
 * that follows is already authenticated — which is precisely the production bug
 * this rewrite exists to fix (a completed sign-up that landed back on the
 * marketing page instead of inside the product).
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
      // signInWithOtp with shouldCreateUser: false and no such user.
      return { error: "No KIVO account uses that email yet. Create one instead." };
    case "signup_disabled":
      return { error: "New sign-ups are turned off right now. Try again later." };
    case "email_address_invalid":
    case "validation_failed":
      return { error: "That doesn't look like a valid email address." };
    case "email_address_not_authorized":
      return { error: "That email address isn't allowed to sign in to this environment." };
    case "user_banned":
      return { error: "This account has been suspended. Contact support if you think that's wrong." };
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return {
        error: "Too many codes requested. Wait a moment before asking for another.",
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

  console.error(`Supabase auth ${mode} failed`, { code, status: error.status, message });
  return { error: "Something went wrong on our side. Try again in a moment." };
}

/** Supabase phrases its per-email throttle as "you can only request this after
 *  N seconds"; surface that exact number so the form's countdown is honest. */
function secondsFromRateLimitMessage(message: string): number | undefined {
  const match = /after (\d+) seconds?/i.exec(message);
  return match ? Number(match[1]) : undefined;
}

/**
 * Server-side throttling for the two endpoints anyone on the internet can hit
 * without an account.
 *
 * These are not ordinary actions. `sendEmailCode` makes KIVO's own domain send
 * mail to an address the caller chose, so unthrottled it is both a cost problem
 * and a sending-reputation one — a burst of abuse can get the domain blocked,
 * which breaks sign-up for everybody. `verifyEmailCode` guesses at a six-digit
 * secret, so unthrottled it is a brute-force oracle. The form's resend cooldown
 * is a courtesy to honest users and nothing more: it lives in the browser and
 * is trivially bypassed by posting to the action directly.
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
    console.error(
      `Rate limiting is NOT active for ${action} — SUPABASE_SERVICE_ROLE_KEY is missing or invalid. ` +
        "This endpoint is unthrottled until that is fixed.",
      error,
    );
  }
  return undefined;
}

/**
 * Step 1: email a six-digit code.
 *
 * `shouldCreateUser` is what makes /sign-in and /sign-up genuinely different
 * routes rather than cosmetic variants: on /sign-in an unknown address is told
 * so instead of silently having an account created for it, and on /sign-up an
 * existing address just receives a code and signs in.
 *
 * WHICH EMAIL SUPABASE ACTUALLY SENDS — read this before changing anything here.
 * `signInWithOtp({ email })` does NOT always send the "Magic Link" template. For
 * an address that has never signed up it performs a signup and sends **Confirm
 * signup**; for an existing address it sends **Magic Link**. Both templates must
 * therefore contain `{{ .Token }}`, or brand-new users receive a link with no
 * code in it while this form waits for a code that was never sent — the exact
 * "sign-up looks broken, sign-in works" symptom this migration exists to end.
 * docs/email-templates/README.md carries the templates and the dashboard steps.
 *
 * `emailRedirectTo` below is the safety net for that being got wrong: it points
 * the link in whichever template is sent at /auth/callback, which signs the user
 * in and lands them in the same place the code path would. A misconfigured
 * template then degrades to "the link works, the code is missing" instead of a
 * dead end.
 */
export async function sendEmailCode(
  email: string,
  mode: AuthMode,
  redirectTo?: string,
): Promise<AuthActionResult | undefined> {
  if (!isAuthConfigured()) {
    return { error: "Sign-in isn't configured in this environment yet." };
  }

  const address = email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(address)) {
    return { error: "Enter a valid email address." };
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
    options: {
      shouldCreateUser: mode === "sign-up",
      emailRedirectTo: callback.toString(),
    },
  });

  if (error) return describeAuthError(error, mode);
  return undefined;
}

/**
 * Absolute origin of the current request, for the one thing that genuinely
 * needs one: the link Supabase embeds in the email, which is opened from a mail
 * client with no relation to this request. Prefers the explicitly configured
 * public URL and falls back to the forwarded host, so it is right in local dev,
 * on a preview deployment, and in production without being configured three
 * different ways.
 */
async function requestOrigin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const protocol = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

/**
 * Step 2: exchange the code for a session, then land the user INSIDE the app.
 *
 * The destination is decided here rather than left to the client so that a
 * brand-new signee cannot end up anywhere except onboarding, and a returning
 * user cannot be talked into a destination they didn't ask for
 * (`sanitizeRedirectPath` re-validates the path server-side even though the
 * page already validated it — the client controls what it posts back).
 */
export async function verifyEmailCode(
  email: string,
  code: string,
  redirectTo?: string,
): Promise<AuthActionResult | undefined> {
  if (!isAuthConfigured()) {
    return { error: "Sign-in isn't configured in this environment yet." };
  }

  const address = email.trim().toLowerCase();
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

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.auth.verifyOtp({ email: address, token, type: "email" });
  if (error) return describeAuthError(error, "sign-in");

  // The session cookies are written by now, and createServerSupabaseClient() is
  // request-cached, so this call already runs as the freshly signed-in user —
  // creating their profile row on the spot if this is their first visit.
  const viewer = await resolveViewerProfile();

  // Signed in, but the profile row could not be read or created. Reported in
  // place rather than redirected: sending them into (app) would render the
  // terminal ProfileUnavailable screen a navigation later, and telling them
  // right here — on the form they are already looking at, with the code still
  // typed — is both faster and clearer.
  if (viewer.status !== "ready") {
    return { error: "You're signed in, but your KIVO profile couldn't be set up. Try again." };
  }

  // redirect() throws NEXT_REDIRECT, so it must stay outside any try/catch.
  if (!viewer.profile.onboarding_completed) redirect("/onboarding");
  redirect(sanitizeRedirectPath(redirectTo) ?? "/home");
}

// Signing OUT lives in src/app/(app)/session-actions.ts, alongside the
// "sign out other devices" control it shares a mental model with.
