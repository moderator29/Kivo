import Image from "next/image";
import Link from "next/link";
import { signOut } from "@/app/(app)/session-actions";
import kivoLogo from "../../../public/brand/kivo-logo-transparent.webp";

/**
 * Terminal, honest failure for the one state that must never redirect: the
 * viewer holds a valid Supabase Auth session, but their KIVO profile row could
 * not be read or created (an RLS rejection, a lost insert race, a transient
 * database error).
 *
 * Redirecting here is what created the bug this component exists to prevent.
 * The app group would send them to /sign-in, /sign-in would see a perfectly
 * good session and send them straight back, and the user would sit in a loop
 * that looks exactly like "sign-in keeps throwing me out" — the founder's
 * original symptom. So this stops, says what happened, and offers the only two
 * things that can actually help: try again, or drop the session and start over.
 */
export function ProfileUnavailable({ retryHref = "/home" }: { retryHref?: string }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-8 overflow-hidden bg-background px-4 py-12">
      <div className="kivo-aurora" aria-hidden="true">
        <span className="kivo-aurora-blob kivo-aurora-blob--cyan" />
        <span className="kivo-aurora-blob kivo-aurora-blob--violet" />
        <span className="kivo-aurora-blob kivo-aurora-blob--magenta" />
      </div>

      <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-8">
        <Image src={kivoLogo} alt="KIVO" width={112} height={112} className="kivo-ink h-24 w-24" priority />

        <div className="kivo-glass-brand flex w-full flex-col gap-5 rounded-3xl p-6 text-center sm:p-8">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">We couldn&apos;t load your profile</h1>
            <p className="text-sm text-foreground-muted">
              You&apos;re signed in — that part worked. Your KIVO profile just couldn&apos;t be loaded or set up right
              now. This is on our side, not yours.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <Link
              href={retryHref}
              className="kivo-gradient-prime flex w-full items-center justify-center rounded-xl px-6 py-3.5 text-base font-semibold text-kivo-white shadow-[0_8px_30px_-8px_rgba(37,99,255,0.55)] transition-opacity hover:opacity-90"
            >
              Try again
            </Link>

            {/* Signing out is the real second option: it clears the session, so
                the next attempt starts from a clean sign-in rather than
                retrying against whatever state broke. */}
            <form action={signOut}>
              <button
                type="submit"
                className="w-full rounded-xl border border-hairline bg-surface-inset px-6 py-3 text-sm font-medium text-foreground-muted transition-colors hover:text-foreground"
              >
                Sign out and start over
              </button>
            </form>
          </div>

          {/* KN-118: "get in touch" used to be an instruction with nowhere to
              go — there was no contact surface anywhere in the product. There
              is one now, and it is outside the (app) gate, which matters
              because this screen is itself a gate failure. */}
          <p className="text-xs text-foreground-subtle">
            If this keeps happening,{" "}
            <Link href="/support?topic=account" className="font-medium text-accent transition-colors hover:text-foreground">
              tell us
            </Link>{" "}
            and quote the time you saw it — the failure is logged server-side.
          </p>
        </div>
      </div>
    </div>
  );
}
