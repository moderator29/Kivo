import Image from "next/image";
import { BackLink } from "@/components/ui/back-link";
import { FadeIn } from "@/components/ui/fade-in";
import kivoLogo from "../../../public/brand/kivo-logo-transparent.webp";

/**
 * The chrome every auth screen shares: the aurora field, the mark, and the way
 * back out. Five screens now use it (sign-in, sign-up, forgot-password,
 * reset-password, and the unconfigured-environment notice), and having one copy
 * is what stops them drifting apart visually as they are edited separately.
 *
 * `backHref` matters more than it looks: these pages are reached from the
 * landing page, from the marketing footer and from every gated action in the
 * product. Without an in-page way back, the only exit is the browser's own
 * control — which a phone in standalone/PWA mode does not show at all.
 */
export function AuthScreen({
  children,
  backHref = "/",
  backLabel = "KIVO",
}: {
  children: React.ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-8 overflow-hidden bg-background px-4 py-12">
      <div className="absolute left-3 top-[calc(env(safe-area-inset-top)+12px)] z-20">
        <BackLink href={backHref} label={backLabel} />
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
        <FadeIn delay={0.12} className="flex w-full flex-col items-center gap-4">
          {children}
        </FadeIn>
      </div>
    </div>
  );
}

/**
 * Shown instead of a form when this deployment cannot reach the account
 * system. Honest about which of the three states it is in: not empty, not
 * broken on the reader's side — unavailable.
 *
 * FRONTEND SWEEP: this used to read "isn't configured in this environment yet.
 * See ENVIRONMENT.md for the required Supabase keys." That is a message to
 * whoever deployed KIVO, rendered on /sign-in and /sign-up, which are the two
 * pages a stranger sees first. It named an internal document and a vendor, and
 * asked a football fan to go and read the repository. The reader here can do
 * exactly one thing — come back later — so that is the only thing this says.
 * The detail an operator needs is in the server logs, where the operator is.
 */
export function AuthUnconfigured({ what }: { what: string }) {
  return (
    <div
      role="status"
      className="kivo-glass-brand max-w-sm rounded-3xl p-6 text-center text-sm text-foreground-muted"
    >
      {what} isn&apos;t available right now. This one is on KIVO, not on you — try again shortly.
    </div>
  );
}
