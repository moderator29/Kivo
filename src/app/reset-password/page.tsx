import { redirect } from "next/navigation";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { AuthScreen, AuthUnconfigured } from "@/components/auth/auth-screen";
import { isAuthConfigured } from "@/lib/auth";
import { getAuthUser } from "@/lib/auth";

export const metadata = { title: "Choose a new password" };

// Reads the session, which cannot be prerendered.
export const dynamic = "force-dynamic";

/**
 * Where a tapped "Reset my password" link ends up: /auth/callback has already
 * exchanged it for a session, and this is the form that chooses the password.
 *
 * Gated on the SESSION, not on a profile. A recovery link is a valid session, so
 * `getAuthUser()` — which verifies the JWT's signature against the project's
 * JWKS rather than trusting the cookie — is the right question, and it means
 * somebody whose profile row is missing can still finish setting a password
 * instead of being bounced into the profile-unavailable screen.
 *
 * Without a session there is nothing to change and nothing to guess at, so this
 * says the link is spent and offers a new one. It never renders an empty form
 * that would fail on submit.
 *
 * Worth stating plainly: this changes the password of whoever holds the session,
 * with no old-password challenge. That is Supabase's default behaviour for
 * `updateUser({ password })` and it is consistent with the rest of KIVO, where
 * an ordinary session can already delete the whole account. If the project ever
 * turns on Supabase's "Secure password change" (which requires recent
 * reauthentication), `updatePasswordForRecoverySession` will start returning
 * `reauthentication_needed` and this screen will need a second step.
 */
export default async function ResetPasswordPage() {
  if (!isAuthConfigured()) {
    return (
      <AuthScreen backHref="/sign-in" backLabel="Sign in">
        <AuthUnconfigured what="Password reset" />
      </AuthScreen>
    );
  }

  const user = await getAuthUser();
  if (!user) {
    redirect("/sign-in?error=recovery_expired");
  }

  return (
    <AuthScreen backHref="/sign-in" backLabel="Sign in">
      <ResetPasswordForm />
    </AuthScreen>
  );
}
