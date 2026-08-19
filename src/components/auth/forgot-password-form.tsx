"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Mail } from "lucide-react";
import { requestPasswordReset, resetPasswordWithCode } from "@/lib/auth-actions";
import { RESEND_COOLDOWN_SECONDS, type SignUpField } from "@/lib/auth-shared";
import {
  CodeInput,
  Field,
  FIELD_CLASS,
  FormMessage,
  PasswordInput,
  PasswordRules,
  SubmitButton,
} from "./auth-form-parts";

/**
 * Forgotten password, in two screens: ask for the address, then redeem the
 * emailed code and choose a new password on one screen.
 *
 * TWO THINGS THIS DOES NOT DO, both on purpose.
 *
 * It does not say whether the address has an account. `requestPasswordReset`
 * always answers the same way and this form always advances, because a reset
 * form is the single most inviting place to ask "is this person on KIVO?" — it
 * is the one screen where typing somebody else's address is normal. The copy on
 * the second screen is written to be true either way: it says a code is on its
 * way *if* the address has an account, and never claims one was sent.
 *
 * It does not split "verify the code" and "choose a password" into two steps.
 * Between them would sit a live recovery session in a cookie that can change a
 * password; doing both in one Server Action keeps that window at zero.
 */
export function ForgotPasswordForm() {
  const [step, setStep] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<SignUpField | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [pending, startTransition] = useTransition();
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (step === "reset") codeInputRef.current?.focus();
  }, [step]);

  function sendCode({ resend }: { resend: boolean }) {
    setError(null);
    setErrorField(null);
    setNotice(null);
    startTransition(async () => {
      const result = await requestPasswordReset(email);
      if (result) {
        setError(result.error);
        setErrorField(result.field ?? null);
        if (result.retryAfterSeconds) setCooldown(result.retryAfterSeconds);
        return;
      }
      setStep("reset");
      setCooldown(RESEND_COOLDOWN_SECONDS);
      if (resend) {
        setCode("");
        setNotice("If that address has a KIVO account, another code is on its way.");
      }
    });
  }

  function submitEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendCode({ resend: false });
  }

  function submitReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setErrorField(null);
    setNotice(null);
    startTransition(async () => {
      // Only returns on failure — success signs them in and redirects away.
      const result = await resetPasswordWithCode(email, code, password, confirmPassword);
      if (result) {
        setError(result.error);
        setErrorField(result.field ?? null);
      }
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
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Reset your password</h1>
              <p className="text-sm text-foreground-muted">
                Enter your email and we&apos;ll send you a 6-digit code to set a new password with.
              </p>
            </header>

            <form onSubmit={submitEmail} noValidate className="flex flex-col gap-3">
              <label htmlFor="reset-email" className="sr-only">
                Email address
              </label>
              <div className="relative">
                <Mail
                  strokeWidth={1.75}
                  className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle"
                  aria-hidden="true"
                />
                <input
                  id="reset-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  autoFocus
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  aria-invalid={errorField === "email" ? true : undefined}
                  className={`${FIELD_CLASS} pl-11`}
                />
              </div>

              <FormMessage error={error} notice={notice} />

              <SubmitButton pending={pending}>Send reset code</SubmitButton>
            </form>

            <p className="text-center text-xs text-foreground-subtle">
              Remembered it?{" "}
              <Link href="/sign-in" className="font-medium text-accent transition-colors hover:text-foreground">
                Back to sign in
              </Link>
            </p>
          </motion.div>
        ) : (
          <motion.div
            key="reset"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.18 }}
            className="flex flex-col gap-5"
          >
            <header className="flex flex-col gap-1.5 text-center">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Choose a new password</h1>
              {/* Deliberately hedged: this screen is shown whether or not that
                  address has an account, so it must not claim an email was
                  sent. */}
              <p className="text-sm text-foreground-muted">
                If <span className="font-medium text-foreground">{email}</span> has a KIVO account, a 6-digit code is on
                its way to it.
              </p>
            </header>

            <form onSubmit={submitReset} noValidate className="flex flex-col gap-4">
              <CodeInput
                value={code}
                onChange={setCode}
                invalid={Boolean(error) && errorField === null}
                inputRef={codeInputRef}
              />

              <Field label="New password" htmlFor="password" error={errorField === "password" ? error : null}>
                <PasswordInput
                  id="password"
                  value={password}
                  onChange={setPassword}
                  autoComplete="new-password"
                  invalid={errorField === "password"}
                />
              </Field>
              <PasswordRules password={password} />

              <Field
                label="Confirm new password"
                htmlFor="confirmPassword"
                error={errorField === "confirmPassword" ? error : null}
                hint={
                  confirmPassword.length > 0 && confirmPassword !== password ? (
                    <span className="text-critical">Both passwords must match.</span>
                  ) : null
                }
              >
                <PasswordInput
                  id="confirmPassword"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  autoComplete="new-password"
                  invalid={errorField === "confirmPassword"}
                />
              </Field>

              <FormMessage error={errorField === null ? error : null} notice={notice} />

              <SubmitButton pending={pending}>Set password and sign in</SubmitButton>
            </form>

            <div className="flex flex-col items-center gap-2 text-xs">
              <button
                type="button"
                disabled={pending || cooldown > 0}
                onClick={() => sendCode({ resend: true })}
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
                  setErrorField(null);
                  setNotice(null);
                }}
                className="inline-flex items-center gap-1 text-foreground-subtle transition-colors hover:text-foreground-muted disabled:opacity-50"
              >
                <ArrowLeft strokeWidth={2} className="h-3 w-3" aria-hidden="true" />
                Use a different email
              </button>
            </div>

            <div className="flex flex-col gap-2 border-t border-hairline-soft pt-4 text-center text-xs text-foreground-subtle">
              <p>
                The email also has a <span className="text-foreground-muted">Reset my password</span> link. Tapping that
                on this device works too.
              </p>
              <p>
                Never set a password?{" "}
                <Link href="/sign-in" className="font-medium text-accent transition-colors hover:text-foreground">
                  Sign in with a 6-digit code
                </Link>{" "}
                instead — this is also how you set your first one.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
