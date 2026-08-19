"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { ArrowLeft, KeyRound, Mail } from "lucide-react";
import { sendEmailCode, verifyEmailCode } from "@/lib/auth-actions";
import { RESEND_COOLDOWN_SECONDS } from "@/lib/auth-shared";
import { CodeInput, FIELD_CLASS, FormMessage, SubmitButton } from "./auth-form-parts";

/**
 * The second door: sign in with a six-digit code instead of a password.
 *
 * KIVO shipped passwordless first, so this was the ONLY way in until now. It is
 * kept — deliberately, and as the secondary option behind
 * src/components/auth/sign-in-form.tsx — for two reasons specific to this
 * deployment rather than a general preference for choice:
 *
 *   1. Every account created before passwords existed has no password. Deleting
 *      this path on the night passwords ship would make those users' only route
 *      in a reset email that has to arrive.
 *   2. It is the working recovery path when a password is simply gone, on a
 *      product whose support surface is one page.
 *
 * The failure the brief warns about is two *half-maintained* paths, so both go
 * through the same Server Actions in src/lib/auth-actions.ts, the same rate
 * limits, the same error translation and the same form primitives. Nothing here
 * is a second implementation of anything.
 *
 * It can no longer CREATE an account: `sendEmailCode` now always passes
 * `shouldCreateUser: false`, because a KIVO account needs a username, a country
 * and an agreement this form does not collect. Sign-up is /sign-up.
 */
export function EmailCodeForm({
  redirectTo,
  addAccount = false,
  onUsePassword,
}: {
  redirectTo?: string;
  /** Set only by the "Add account" entry point in the account switcher. It
   *  travels all the way to `verifyEmailCode`, which uses it to decide whether
   *  the session this one replaces is kept for switching back to. Nothing here
   *  changes until a code is actually verified, which is what makes abandoning
   *  this form harmless. */
  addAccount?: boolean;
  /** Renders the "use my password instead" way back. Omitted where there is no
   *  password form to go back to. */
  onUsePassword?: () => void;
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
      const result = await sendEmailCode(nextEmail, "sign-in", redirectTo);
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

  if (step === "email") {
    return (
      <motion.div
        key="email"
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.18 }}
        className="flex flex-col gap-5"
      >
        <header className="flex flex-col gap-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {addAccount ? "Add another account" : "Sign in with a code"}
          </h1>
          <p className="text-sm text-foreground-muted">
            {addAccount
              ? "Enter the email for the account you want to add. You'll stay signed in to the one you're using until this one is verified."
              : "Enter your email and we'll send you a 6-digit code. No password needed."}
          </p>
        </header>

        <form onSubmit={submitEmail} noValidate className="flex flex-col gap-3">
          <label htmlFor="code-email" className="sr-only">
            Email address
          </label>
          <div className="relative">
            <Mail
              strokeWidth={1.75}
              className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle"
              aria-hidden="true"
            />
            <input
              id="code-email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              aria-invalid={error ? true : undefined}
              className={`${FIELD_CLASS} pl-11`}
            />
          </div>

          <FormMessage error={error} notice={notice} />

          <SubmitButton pending={pending}>Send sign-in code</SubmitButton>
        </form>

        {onUsePassword ? (
          <button
            type="button"
            onClick={onUsePassword}
            className="inline-flex items-center justify-center gap-1.5 text-xs font-medium text-accent transition-colors hover:text-foreground"
          >
            <KeyRound strokeWidth={2} className="h-3.5 w-3.5" aria-hidden="true" />
            Use my password instead
          </button>
        ) : null}
      </motion.div>
    );
  }

  return (
    <motion.div
      key="code"
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18 }}
      className="flex flex-col gap-5"
    >
      <header className="flex flex-col gap-1.5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Check your email</h1>
        <p className="text-sm text-foreground-muted">
          We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>.
        </p>
      </header>

      <form onSubmit={submitCode} noValidate className="flex flex-col gap-3">
        <CodeInput value={code} onChange={setCode} invalid={Boolean(error)} inputRef={codeInputRef} />
        <FormMessage error={error} notice={notice} />
        <SubmitButton pending={pending}>Verify and continue</SubmitButton>
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
             otherwise leave someone staring at this screen forever — every KIVO
             auth email also carries a sign-in link, and /auth/callback lands it
             in the same place this form would.
          2. KN-124: this screen is shown whether or not the address has a KIVO
             account, because answering that question is a membership oracle.
             This line is the UX that replaces the answer — shown to everyone, so
             it reveals nothing, and it is the same next step the old "no account
             uses that email" message prompted.
          3. KN-118: a code that never arrives at all is a locked-out user with
             nowhere to go. /support is deliberately outside the (app) gate. */}
      <div className="flex flex-col gap-2 border-t border-hairline-soft pt-4 text-center text-xs text-foreground-subtle">
        <p>
          No code in the email? Tap the <span className="text-foreground-muted">Sign in to KIVO</span> link in it
          instead — that signs you in too.
        </p>
        <p>
          Nothing arrived at all? You may not have a KIVO account yet.{" "}
          <Link href="/sign-up" className="font-medium text-accent transition-colors hover:text-foreground">
            Create one
          </Link>
          .
        </p>
        <p>
          Still stuck?{" "}
          <Link href="/support?topic=sign_in" className="font-medium text-accent transition-colors hover:text-foreground">
            Get help signing in
          </Link>
          .
        </p>
      </div>
    </motion.div>
  );
}
