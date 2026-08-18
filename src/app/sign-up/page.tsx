import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FadeIn } from "@/components/ui/fade-in";
import { EmailCodeForm } from "@/components/auth/email-code-form";
import { isAuthConfigured, sanitizeRedirectPath } from "@/lib/auth";
import { resolveViewerProfile } from "@/lib/profile";
import { ProfileUnavailable } from "@/components/auth/profile-unavailable";
import kivoLogo from "../../../public/brand/kivo-logo-transparent.webp";

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
  // is untouched until a new code is verified.
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
            <EmailCodeForm mode="sign-up" redirectTo={redirectTo} addAccount={addAccount} />
            <p className="max-w-xs text-center text-xs text-foreground-subtle">
              By creating an account, you agree to KIVO&apos;s{" "}
              <Link href="/terms" className="text-accent transition-colors hover:text-foreground">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="text-accent transition-colors hover:text-foreground">
                Privacy Policy
              </Link>
              .
            </p>
            <p className="text-xs text-foreground-subtle">
              Already have an account?{" "}
              <Link
                href={redirectTo ? `/sign-in?redirect_url=${encodeURIComponent(redirectTo)}` : "/sign-in"}
                className="font-medium text-accent transition-colors hover:text-foreground"
              >
                Sign in
              </Link>
            </p>
          </FadeIn>
        ) : (
          <FadeIn delay={0.12} className="kivo-glass-brand max-w-sm rounded-3xl p-6 text-center text-sm text-foreground-muted">
            Sign-up isn&apos;t configured in this environment yet. See ENVIRONMENT.md for the required Supabase keys.
          </FadeIn>
        )}
      </div>
    </div>
  );
}
