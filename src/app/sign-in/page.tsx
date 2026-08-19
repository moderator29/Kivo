import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth/sign-in-form";
import { AuthScreen, AuthUnconfigured } from "@/components/auth/auth-screen";
import { isAuthConfigured, sanitizeRedirectPath } from "@/lib/auth";
import { resolveViewerProfile } from "@/lib/profile";
import { ProfileUnavailable } from "@/components/auth/profile-unavailable";

export const metadata = { title: "Sign in" };

// Reads the session and the incoming redirect_url, neither of which can be
// prerendered.
export const dynamic = "force-dynamic";

/** Reasons /auth/callback can send someone back here, in plain language. */
const CALLBACK_ERRORS: Record<string, string> = {
  link_invalid: "That sign-in link has expired or was already used. Sign in below, or request a new code.",
  recovery_expired: "That password reset link has expired or was already used. Request a new one below.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string | string[]; error?: string | string[]; add?: string | string[] }>;
}) {
  const params = await searchParams;
  // Carries a guest's return path through sign-in the same way sign-up does,
  // for gated actions that route here and for a guest who lands here directly
  // with a redirect_url already attached. Sanitized here AND again inside the
  // action — this value originates in a URL anyone can craft.
  const redirectTo = sanitizeRedirectPath(params.redirect_url);

  // /auth/callback bounces failed email links back here rather than to a blank
  // page — say what went wrong instead of silently re-showing the form.
  const linkError = CALLBACK_ERRORS[Array.isArray(params.error) ? params.error[0] : (params.error ?? "")];

  // The one case where a signed-in visitor is allowed to see this form: they
  // came from the account switcher's "Add account". Redirecting them away, as
  // every other signed-in visit is, is precisely what would make adding a
  // second account impossible. Nothing about their current session changes by
  // being here — the sign-in actions only touch it once a new credential is
  // actually accepted (src/lib/auth-actions.ts), so leaving this page mid-flow
  // leaves them exactly as they were.
  const addAccount = (Array.isArray(params.add) ? params.add[0] : params.add) === "1";

  // Someone who is already signed in has no business on this page; send them
  // where they were going instead of showing them a form for an account they
  // are already using.
  //
  // Resolved through the profile rather than the bare session on purpose. A
  // valid session whose profile row won't load must NOT be redirected into the
  // app — the app group would find no profile and send them back here, and the
  // two pages would bounce the user between them indefinitely. This is the
  // other half of that cycle, so it terminates here too.
  const viewer = await resolveViewerProfile();
  if (viewer.status === "ready" && !addAccount) {
    redirect(redirectTo ?? "/home");
  }
  if (viewer.status === "unavailable") {
    return <ProfileUnavailable retryHref="/sign-in" />;
  }

  return (
    <AuthScreen>
      {isAuthConfigured() ? (
        <>
          {linkError ? (
            <p
              role="alert"
              className="max-w-sm rounded-2xl border border-hairline bg-surface-inset px-4 py-3 text-center text-xs text-critical"
            >
              {linkError}
            </p>
          ) : null}

          <SignInForm redirectTo={redirectTo} addAccount={addAccount} />

          <p className="text-xs text-foreground-subtle">
            New to KIVO?{" "}
            <Link
              href={
                addAccount
                  ? "/sign-up?add=1"
                  : redirectTo
                    ? `/sign-up?redirect_url=${encodeURIComponent(redirectTo)}`
                    : "/sign-up"
              }
              className="font-medium text-accent transition-colors hover:text-foreground"
            >
              Create an account
            </Link>
          </p>

          {/* The way out of the add flow that doesn't cost them anything.
              Without it, someone who opened this by accident has no obvious move
              except the browser's back button. */}
          {addAccount && viewer.status === "ready" ? (
            <p className="text-xs text-foreground-subtle">
              Changed your mind?{" "}
              <Link href="/home" className="font-medium text-accent transition-colors hover:text-foreground">
                Stay signed in as @{viewer.profile.username}
              </Link>
            </p>
          ) : null}

          {/* KN-118: the last line of the funnel, and /support is deliberately
              outside the (app) gate so a locked-out person can actually reach
              it. */}
          <p className="text-xs text-foreground-subtle">
            Can&apos;t get in?{" "}
            <Link href="/support?topic=sign_in" className="font-medium text-accent transition-colors hover:text-foreground">
              Get help signing in
            </Link>
          </p>
        </>
      ) : (
        <AuthUnconfigured what="Sign-in" />
      )}
    </AuthScreen>
  );
}
