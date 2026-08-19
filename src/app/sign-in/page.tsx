import Image from "next/image";
import Link from "next/link";
import { BackLink } from "@/components/ui/back-link";
import { redirect } from "next/navigation";
import { FadeIn } from "@/components/ui/fade-in";
import { EmailCodeForm } from "@/components/auth/email-code-form";
import { isAuthConfigured, sanitizeRedirectPath } from "@/lib/auth";
import { resolveViewerProfile } from "@/lib/profile";
import { ProfileUnavailable } from "@/components/auth/profile-unavailable";
import kivoLogo from "../../../public/brand/kivo-logo-transparent.webp";

export const metadata = { title: "Sign in" };

// Reads the session and the incoming redirect_url, neither of which can be
// prerendered.
export const dynamic = "force-dynamic";

/** Reasons /auth/callback can send someone back here, in plain language. */
const CALLBACK_ERRORS: Record<string, string> = {
  link_invalid: "That sign-in link has expired or was already used. Request a new code below.",
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

  // Someone who is already signed in has no business on this page; send them
  // where they were going instead of showing them a form for an account they
  // are already using.
  //
  // Resolved through the profile rather than the bare session on purpose. A
  // valid session whose profile row won't load must NOT be redirected into the
  // app — the app group would find no profile and send them back here, and the
  // two pages would bounce the user between them indefinitely. This is the
  // other half of that cycle, so it terminates here too.
  // The one case where a signed-in visitor is allowed to see this form: they
  // came from the account switcher's "Add account". Redirecting them away, as
  // every other signed-in visit is, is precisely what would make adding a
  // second account impossible. Nothing about their current session changes by
  // being here — `verifyEmailCode` only touches it once a new code is actually
  // verified (src/lib/auth-actions.ts), so leaving this page mid-flow leaves
  // them exactly as they were.
  const addAccount = (Array.isArray(params.add) ? params.add[0] : params.add) === "1";

  const viewer = await resolveViewerProfile();
  if (viewer.status === "ready" && !addAccount) {
    redirect(redirectTo ?? "/home");
  }
  if (viewer.status === "unavailable") {
    return <ProfileUnavailable retryHref="/sign-in" />;
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-8 overflow-hidden bg-background px-4 py-12">
      {/* Sign-in and sign-up are reached from the landing page, from the
          marketing footer, and from every gated action in the product. Without
          this the only way back out is the browser's own control, which a
          phone in standalone/PWA mode does not show. Falls back to the landing
          page for anybody who arrived here from outside KIVO. */}
      <div className="absolute left-3 top-[calc(env(safe-area-inset-top)+12px)] z-20">
        <BackLink href="/" label="KIVO" />
      </div>

      <div className="kivo-aurora" aria-hidden="true">
        <span className="kivo-aurora-blob kivo-aurora-blob--cyan" />
        <span className="kivo-aurora-blob kivo-aurora-blob--violet" />
        <span className="kivo-aurora-blob kivo-aurora-blob--magenta" />
      </div>

      <div className="relative z-10 flex w-full flex-col items-center gap-8">
        <FadeIn>
          <Image src={kivoLogo} alt="KIVO" width={144} height={144} className="kivo-ink h-28 w-28" priority />
        </FadeIn>

        {isAuthConfigured() ? (
          <FadeIn delay={0.12} className="flex w-full flex-col items-center gap-4">
            {linkError ? (
              <p role="alert" className="max-w-sm rounded-2xl border border-hairline bg-surface-inset px-4 py-3 text-center text-xs text-critical">
                {linkError}
              </p>
            ) : null}
            <EmailCodeForm mode="sign-in" redirectTo={redirectTo} addAccount={addAccount} />
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
                Without it, someone who opened this by accident has no obvious
                move except the browser's back button. */}
            {addAccount && viewer.status === "ready" ? (
              <p className="text-xs text-foreground-subtle">
                Changed your mind?{" "}
                <Link href="/home" className="font-medium text-accent transition-colors hover:text-foreground">
                  Stay signed in as @{viewer.profile.username}
                </Link>
              </p>
            ) : null}
            {/* KN-118: the last line of the funnel. With no password and no
                social login, someone whose code never arrives has no other
                move — and /support is deliberately outside the (app) gate so
                they can actually reach it. */}
            <p className="text-xs text-foreground-subtle">
              Can&apos;t get in?{" "}
              <Link href="/support?topic=sign_in" className="font-medium text-accent transition-colors hover:text-foreground">
                Get help signing in
              </Link>
            </p>
          </FadeIn>
        ) : (
          <FadeIn delay={0.12} className="kivo-glass-brand max-w-sm rounded-3xl p-6 text-center text-sm text-foreground-muted">
            Sign-in isn&apos;t configured in this environment yet. See ENVIRONMENT.md for the required Supabase keys.
          </FadeIn>
        )}
      </div>
    </div>
  );
}
