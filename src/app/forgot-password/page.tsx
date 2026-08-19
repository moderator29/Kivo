import { redirect } from "next/navigation";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { AuthScreen, AuthUnconfigured } from "@/components/auth/auth-screen";
import { isAuthConfigured } from "@/lib/auth";
import { resolveViewerProfile } from "@/lib/profile";

export const metadata = { title: "Reset your password" };

// Reads the session, which cannot be prerendered.
export const dynamic = "force-dynamic";

/**
 * Public, deliberately. A person who cannot sign in is by definition signed out,
 * so this route must sit outside the (app) group's gate — the same reasoning
 * that keeps /support reachable.
 *
 * A signed-in visitor is sent away: changing the password of a session you are
 * already holding is a Settings action, not a recovery one, and letting a
 * signed-in browser sit on a recovery form is how a shared phone turns into an
 * account takeover.
 */
export default async function ForgotPasswordPage() {
  const viewer = await resolveViewerProfile();
  if (viewer.status === "ready") {
    redirect("/settings");
  }

  return (
    <AuthScreen backHref="/sign-in" backLabel="Sign in">
      {isAuthConfigured() ? <ForgotPasswordForm /> : <AuthUnconfigured what="Password reset" />}
    </AuthScreen>
  );
}
