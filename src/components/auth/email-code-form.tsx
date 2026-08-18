"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Loader2, Mail } from "lucide-react";
import { sendEmailCode, verifyEmailCode } from "@/lib/auth-actions";
import { RESEND_COOLDOWN_SECONDS, type AuthMode } from "@/lib/auth-shared";

/**
 * KIVO's own email sign-in / sign-up form: address -> six-digit code -> in.
 *
 * Replaced Clerk's drop-in `<SignIn>` / `<SignUp>` widgets, which is why this
 * is styled entirely from the app's own tokens (kivo-glass*, surface-*,
 * hairline, accent, foreground*) instead of a provider's theme object — every
 * colour here follows whichever theme the viewer picked, light or dark, with
 * no second appearance config to keep in sync.
 *
 * Both steps call Server Actions (src/lib/auth-actions.ts). The success path
 * never returns to this component: the action redirects, already carrying the
 * session cookie, so the user lands inside the product rather than back on a
 * public page.
 */
export function EmailCodeForm({
  mode,
  redirectTo,
  addAccount = false,
}: {
  mode: AuthMode;
  redirectTo?: string;
  /** Set only by the "Add account" entry point in the account switcher. It
   *  travels all the way to `verifyEmailCode`, which uses it to decide whether
   *  the session this one replaces is kept for switching back to — see
   *  src/lib/auth-actions.ts. Nothing here changes until a code is actually
   *  verified, which is what makes abandoning this form harmless. */
  addAccount?: boolean;
}) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [pending, startTransition] = useTransition();

  const codeInputRef = useRef<HTMLInputElement>(null);

  // Tick the resend cooldown down once a second. Cleared on unmount and
  // whenever the cooldown is restarted, so a fast resend can't stack timers.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Moving to the code step should put the caret where the user is about to
  // type, not leave them hunting for it after switching to their mail app.
  useEffect(() => {
    if (step === "code") codeInputRef.current?.focus();
  }, [step]);

  function requestCode(nextEmail: string, { resend }: { resend: boolean }) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await sendEmailCode(nextEmail, mode, redirectTo);
      if (result) {
        setError(result.error);
        if (result.retryAfterSeconds) setCooldown(result.retryAfterSeconds);
        return;
      }
      setStep("code");
      setCooldown(RESEND_COOLDOWN_SECONDS);
      if (resend) {
        setCode("");
        setNotice("New code sent. Check your inbox.");
      }
    });
  }

  function submitEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    requestCode(email, { resend: false });
  }

  function submitCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    startTransition(async () => {
      // Only returns on failure — success redirects out of this page entirely.
      const result = await verifyEmailCode(email, code, redirectTo, addAccount);
      if (result) setError(result.error);
    });
  }

  return (
    <div className="kivo-glass-brand w-full max-w-sm rounded-3xl p-6 sm:p-8">
      <AnimatePresence mode="wait" initial={false}>
        {step === "email" ? (
          <motion.div
            key="email"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.18 }}
            className="flex flex-col gap-5"
          >
            <header className="flex flex-col gap-1.5 text-center">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {addAccount
                  ? mode === "sign-up"
                    ? "Create another account"
                    : "Add another account"
                  : mode === "sign-up"
                    ? "Create your KIVO account"
                    : "Welcome back"}
              </h1>
              <p className="text-sm text-foreground-muted">
                {addAccount
                  ? "Enter the email for the account you want to add. You'll stay signed in to the one you're using until this one is verified."
                  : mode === "sign-up"
                    ? "Enter your email and we'll send you a 6-digit code to get started. No password to remember."
                    : "Enter your email and we'll send you a 6-digit code."}
              </p>
            </header>

            <form onSubmit={submitEmail} className="flex flex-col gap-3">
              <label htmlFor="email" className="sr-only">
                Email address
              </label>
              <div className="relative">
                <Mail strokeWidth={1.75}
                  className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle"
                  aria-hidden="true"
                />
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  aria-invalid={error ? true : undefined}
                  className="kivo-focusable w-full rounded-2xl border border-hairline bg-surface-inset py-3.5 pl-11 pr-4 text-base text-foreground transition-colors placeholder:text-foreground-subtle focus:border-accent focus:outline-none"
                />
              </div>

              <FormMessage error={error} notice={notice} />

              <SubmitButton pending={pending} disabled={email.trim().length === 0}>
                {mode === "sign-up" ? "Send my code" : "Send sign-in code"}
              </SubmitButton>
            </form>
          </motion.div>
        ) : (
          <motion.div
            key="code"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.18 }}
            className="flex flex-col gap-5"
          >
            <header className="flex flex-col gap-1.5 text-center">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Check your email</h1>
              <p className="text-sm text-foreground-muted">
                We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>.
              </p>
            </header>

            <form onSubmit={submitCode} className="flex flex-col gap-3">
              <label htmlFor="code" className="sr-only">
                6-digit code
              </label>
              <input
                id="code"
                name="code"
                ref={codeInputRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                required
                value={code}
                // Strip everything but digits as they type, so a pasted
                // "123 456" or a code copied with a stray space still works.
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                aria-invalid={error ? true : undefined}
                className="kivo-focusable w-full rounded-2xl border border-hairline bg-surface-inset px-4 py-3.5 text-center font-mono text-2xl tracking-[0.5em] text-foreground transition-colors placeholder:text-foreground-subtle/50 focus:border-accent focus:outline-none"
              />

              <FormMessage error={error} notice={notice} />

              <SubmitButton pending={pending} disabled={code.length !== 6}>
                Verify and continue
              </SubmitButton>
            </form>

            <div className="flex flex-col items-center gap-2 text-xs">
              <button
                type="button"
                disabled={pending || cooldown > 0}
                onClick={() => requestCode(email, { resend: true })}
                className="font-medium text-accent transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:text-foreground-subtle"
              >
                {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setError(null);
                  setNotice(null);
                }}
                className="inline-flex items-center gap-1 text-foreground-subtle transition-colors hover:text-foreground-muted disabled:opacity-50"
              >
                <ArrowLeft strokeWidth={2} className="h-3 w-3" aria-hidden="true" />
                Use a different email
              </button>
            </div>

            {/* The honest escape hatches, in the order a stuck user needs them.
                1. A template missing its code variable (see sendEmailCode) would
                   otherwise leave someone staring at this screen forever — every
                   KIVO auth email also carries a sign-in link, and /auth/callback
                   lands it in the same place this form would.
                2. KN-124: on /sign-in this screen is now shown whether or not the
                   address has a KIVO account, because answering that question is
                   a membership oracle. This line is the UX that replaces the
                   answer — shown to everyone, so it reveals nothing, and it is
                   the same next step the old "no account uses that email"
                   message prompted.
                3. KN-118: with no password and no social login, a code that never
                   arrives at all is a locked-out user with nowhere to go. */}
            <div className="flex flex-col gap-2 border-t border-hairline-soft pt-4 text-center text-xs text-foreground-subtle">
              <p>
                No code in the email? Tap the <span className="text-foreground-muted">Sign in to KIVO</span> link in it
                instead — that signs you in too.
              </p>
              {mode === "sign-in" ? (
                <p>
                  Nothing arrived at all? You may not have a KIVO account yet.{" "}
                  <Link href="/sign-up" className="font-medium text-accent transition-colors hover:text-foreground">
                    Create one
                  </Link>
                  .
                </p>
              ) : null}
              <p>
                Still stuck?{" "}
                <Link href="/support" className="font-medium text-accent transition-colors hover:text-foreground">
                  Get help signing in
                </Link>
                .
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * One live region for both halves of the form's feedback. `role="status"`
 * rather than `role="alert"` for the notice so a resend confirmation doesn't
 * interrupt a screen reader mid-sentence; the error is assertive because it
 * blocks progress.
 */
function FormMessage({ error, notice }: { error: string | null; notice: string | null }) {
  return (
    <AnimatePresence initial={false}>
      {error ? (
        <motion.p
          key="error"
          role="alert"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
          className="text-center text-xs text-critical"
        >
          {error}
        </motion.p>
      ) : notice ? (
        <motion.p
          key="notice"
          role="status"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
          className="text-center text-xs text-live"
        >
          {notice}
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}

function SubmitButton({
  children,
  pending,
  disabled,
}: {
  children: React.ReactNode;
  pending: boolean;
  disabled?: boolean;
}) {
  return (
    <motion.button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      whileHover={pending || disabled ? undefined : { scale: 1.02 }}
      whileTap={pending || disabled ? undefined : { scale: 0.97 }}
      className="kivo-gradient-prime flex w-full items-center justify-center gap-2 rounded-full px-6 py-3.5 text-base font-semibold text-kivo-white shadow-[0_8px_30px_-8px_rgba(37,99,255,0.55)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
    >
      {pending ? <Loader2 strokeWidth={1.75} className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </motion.button>
  );
}
