import Link from "next/link";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { AuthScreen, AuthUnconfigured } from "@/components/auth/auth-screen";
import { isAuthConfigured, sanitizeRedirectPath } from "@/lib/auth";
import { resolveViewerProfile } from "@/lib/profile";
import { ProfileUnavailable } from "@/components/auth/profile-unavailable";
import { getSortedCountries } from "@/lib/countries";

export const metadata = { title: "Create your account" };

// Reads the session and the incoming redirect_url, neither of which can be
// prerendered.
export const dynamic = "force-dynamic";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string | string[]; add?: string | string[] }>;
}) {
  // Guest-gated actions (like, predict, send, post) send guests here with
  // ?redirect_url=<the page they were on> so signing up actually returns them
  // to what they were doing. Sanitized here AND again inside the action — this
  // value originates in a URL anyone can craft.
  const params = await searchParams;
  const redirectTo = sanitizeRedirectPath(params.redirect_url);

  // Mirrors /sign-in: a signed-in visitor is normally sent away from here, but
  // the account switcher's "Add account" can legitimately land someone who is
  // already signed in on a form for a brand-new account. Their current session
  // is untouched until the new one is verified.
  const addAccount = (Array.isArray(params.add) ? params.add[0] : params.add) === "1";

  // Same reasoning as /sign-in: resolved through the profile, not the bare
  // session, so a session whose profile won't load terminates here instead of
  // being volleyed between this page and the app group forever.
  const viewer = await resolveViewerProfile();
  if (viewer.status === "ready" && !addAccount) {
    redirect(redirectTo ?? "/home");
  }
  if (viewer.status === "unavailable") {
    return <ProfileUnavailable retryHref="/sign-up" />;
  }

  return (
    <AuthScreen>
      {isAuthConfigured() ? (
        <>
          {/* The Privacy Policy and Terms are agreed to INSIDE the form now, on
              a real checkbox that is unchecked by default and is re-checked
              server-side. The old copy here — a sentence saying that creating an
              account implied agreement — was not a control the user could
              decline, and could not be enforced anywhere. */}
          {/* Built here, on the server, and handed down as data. Building it in
              the client component instead made the server and the browser
              disagree — `Intl.DisplayNames` and `localeCompare` resolve against
              each runtime's own ICU data — which React reports as a hydration
              failure and recovers from by throwing the tree away. A form that
              re-renders from scratch on every load is a form whose buttons can
              look dead, which is the exact symptom this release exists to fix. */}
          <SignUpForm countries={getSortedCountries()} redirectTo={redirectTo} addAccount={addAccount} />

          <p className="text-xs text-foreground-subtle">
            Already have an account?{" "}
            <Link
              href={redirectTo ? `/sign-in?redirect_url=${encodeURIComponent(redirectTo)}` : "/sign-in"}
              className="font-medium text-accent transition-colors hover:text-foreground"
            >
              Sign in
            </Link>
          </p>
        </>
      ) : (
        <AuthUnconfigured what="Sign-up" />
      )}
    </AuthScreen>
  );
}
