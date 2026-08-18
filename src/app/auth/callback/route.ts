import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { sanitizeRedirectPath } from "@/lib/auth";

/**
 * The link half of the email. KIVO's sign-in flow is code-first — the user types
 * the six digits from their email into src/components/auth/email-code-form.tsx —
 * but every KIVO auth email also carries a tap-to-sign-in link, and this is where
 * that link lands.
 *
 * It exists so the flow cannot dead-end on a dashboard misconfiguration. Supabase
 * decides which template to send, and the branch is not obvious:
 * `signInWithOtp({ email })` sends **Confirm signup** for an address that has
 * never signed up and **Magic Link** for one that has. If either template is
 * missing `{{ .Token }}`, that email has a link in it and no code — and a user
 * staring at a code screen for a code that was never sent is exactly the
 * production failure this migration exists to end. With this route, that email
 * still works: they tap the link and arrive signed in.
 * (docs/email-templates/README.md is the authority on installing the templates.)
 *
 * Handles both link shapes Supabase can produce:
 *  - `?code=...`       — the PKCE authorization code that `{{ .ConfirmationURL }}`
 *                        redirects back with. Exchanged against the code verifier
 *                        cookie that `signInWithOtp` set on this same browser.
 *  - `?token_hash=&type=` — the shape a template using `{{ .TokenHash }}` builds
 *                        directly.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  // Same open-redirect protection as the sign-in page: this arrives in a URL and
  // is not trustworthy just because we put it there.
  const next = sanitizeRedirectPath(searchParams.get("next") ?? searchParams.get("redirect_url"));

  const supabase = createServerSupabaseClient();

  let failed = true;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failed = Boolean(error);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
    failed = Boolean(error);
  }

  if (failed) {
    // Nothing usable in the URL, or the link is expired/already used. Send them
    // back to sign-in with an honest reason rather than to a blank page.
    return NextResponse.redirect(new URL("/sign-in?error=link_invalid", origin));
  }

  // Mirrors verifyEmailCode()'s destination logic so both halves of the email
  // land in exactly the same place.
  const profile = await getOrCreateProfile();
  if (!profile) {
    return NextResponse.redirect(new URL("/sign-in?error=profile_failed", origin));
  }
  if (!profile.onboarding_completed) {
    return NextResponse.redirect(new URL("/onboarding", origin));
  }
  return NextResponse.redirect(new URL(next ?? "/home", origin));
}
