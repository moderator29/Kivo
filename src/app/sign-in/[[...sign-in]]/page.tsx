import Image from "next/image";
import { SignIn } from "@clerk/nextjs";
import { FadeIn } from "@/components/ui/fade-in";
import { sanitizeRedirectPath } from "@/lib/clerk";
import kivoLogo from "../../../../public/brand/kivo-logo-transparent.webp";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
}) {
  const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  // Symmetric with sign-up: carries a guest's return path through here too,
  // in case a gated action ever routes to sign-in instead, or a guest lands
  // here directly with a redirect_url already attached.
  //
  // fallbackRedirectUrl="/home" below fixes the same real bug sign-up had:
  // without it, Clerk's own default post-sign-in destination is "/" (the
  // marketing landing page), not anywhere inside (app) — a returning user
  // with no redirect_url would land back on the landing page instead of the
  // app, which reads exactly like sign-in silently failing.
  const redirectUrl = sanitizeRedirectPath((await searchParams).redirect_url);

  return (
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
          <FadeIn delay={0.12}>
            <SignIn
              forceRedirectUrl={redirectUrl}
              fallbackRedirectUrl="/home"
              signUpForceRedirectUrl={redirectUrl}
              signUpFallbackRedirectUrl="/home"
            />
          </FadeIn>
        ) : (
          <FadeIn
            delay={0.12}
            className="kivo-glass-brand max-w-sm rounded-3xl p-6 text-center text-sm text-foreground-muted"
          >
            Sign-in isn&apos;t configured in this environment yet. See ENVIRONMENT.md for the required Clerk keys.
          </FadeIn>
        )}
      </div>
    </div>
  );
}
