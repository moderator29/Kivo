import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FadeIn } from "@/components/ui/fade-in";
import { EmailCodeForm } from "@/components/auth/email-code-form";
import { getAuthUser, isAuthConfigured, sanitizeRedirectPath } from "@/lib/auth";
import kivoLogo from "../../../public/brand/kivo-logo-transparent.webp";

export const metadata = { title: "Sign in" };

// Reads the session and the incoming redirect_url, neither of which can be
// prerendered.
export const dynamic = "force-dynamic";

/** Reasons /auth/callback can send someone back here, in plain language. */
const CALLBACK_ERRORS: Record<string, string> = {
  link_invalid: "That sign-in link has expired or was already used. Request a new code below.",
  profile_failed: "You're signed in, but your KIVO profile couldn't be set up. Try once more.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string | string[]; error?: string | string[] }>;
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
  if (await getAuthUser()) {
    redirect(redirectTo ?? "/home");
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-8 overflow-hidden bg-background px-4 py-12">
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
            <EmailCodeForm mode="sign-in" redirectTo={redirectTo} />
            <p className="text-xs text-foreground-subtle">
              New to KIVO?{" "}
              <Link
                href={redirectTo ? `/sign-up?redirect_url=${encodeURIComponent(redirectTo)}` : "/sign-up"}
                className="font-medium text-accent transition-colors hover:text-foreground"
              >
                Create an account
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
