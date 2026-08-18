import Image from "next/image";
import Link from "next/link";
import { SignUp } from "@clerk/nextjs";
import { FadeIn } from "@/components/ui/fade-in";
import { sanitizeRedirectPath } from "@/lib/clerk";
import kivoLogo from "../../../../public/brand/kivo-logo-transparent.webp";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
}) {
  const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  // Guest-gated actions (like, predict, send, post) send guests here with
  // ?redirect_url=<the page they were on> so signing up actually returns
  // them to what they were doing instead of dumping them on the generic
  // post-sign-up destination. Also threaded into signInForceRedirectUrl so
  // the redirect survives a guest clicking "Already have an account?"
  // inside the widget instead of completing sign-up.
  const redirectUrl = sanitizeRedirectPath((await searchParams).redirect_url);

  return (
    // Real bug this fixed: with no fallbackRedirectUrl set, Clerk's own
    // default post-sign-up destination is "/" (this app's marketing landing
    // page), not anywhere inside (app). A brand-new signee never reached
    // (app)/layout.tsx's onboarding_completed check, because they never hit
    // an (app) route at all — landing back on the marketing page reads
    // exactly like sign-up silently failing. fallbackRedirectUrl only
    // applies when forceRedirectUrl (the guest-return-path case above) is
    // unset, so a guest's original destination still takes priority.
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-8 overflow-hidden bg-background px-4 py-12">
      <div className="kivo-aurora" aria-hidden="true">
        <span className="kivo-aurora-blob kivo-aurora-blob--cyan" />
        <span className="kivo-aurora-blob kivo-aurora-blob--violet" />
        <span className="kivo-aurora-blob kivo-aurora-blob--magenta" />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-8">
        <FadeIn>
          <Image src={kivoLogo} alt="KIVO" width={144} height={144} className="kivo-ink h-32 w-32" priority />
        </FadeIn>

        {clerkConfigured ? (
          <FadeIn delay={0.12} className="flex flex-col items-center gap-4">
            <SignUp
              forceRedirectUrl={redirectUrl}
              fallbackRedirectUrl="/home"
              signInForceRedirectUrl={redirectUrl}
              signInFallbackRedirectUrl="/home"
            />
            <p className="max-w-xs text-center text-xs text-foreground-subtle">
              By signing up, you agree to KIVO&apos;s{" "}
              <Link href="/terms" className="text-accent transition-colors hover:text-foreground">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="text-accent transition-colors hover:text-foreground">
                Privacy Policy
              </Link>
              .
            </p>
          </FadeIn>
        ) : (
          <FadeIn
            delay={0.12}
            className="kivo-glass-brand max-w-sm rounded-3xl p-6 text-center text-sm text-foreground-muted"
          >
            Sign-up isn&apos;t configured in this environment yet. See ENVIRONMENT.md for the required Clerk keys.
          </FadeIn>
        )}
      </div>
    </div>
  );
}
