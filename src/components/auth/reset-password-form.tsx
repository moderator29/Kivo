"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { updatePasswordForRecoverySession } from "@/lib/auth-actions";
import type { SignUpField } from "@/lib/auth-shared";
import { Field, FormMessage, PasswordInput, PasswordRules, SubmitButton } from "./auth-form-parts";

/**
 * The LINK half of password reset.
 *
 * KIVO's reset is code-first (see forgot-password-form.tsx) because the link is
 * PKCE — the code verifier is a cookie on the browser that asked for the reset,
 * so a link opened on a different device cannot complete. This screen is what
 * that link lands on when it IS opened on the right device: /auth/callback has
 * already exchanged it for a recovery session, and all that is left is choosing
 * the password.
 *
 * There is deliberately no email field. Whose password this changes is decided
 * entirely by the recovery session in the cookie, verified against the project's
 * JWKS inside the Server Action — never by anything this form could post.
 */
export function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<SignUpField | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setErrorField(null);
    startTransition(async () => {
      // Only returns on failure — success redirects into the app.
      const result = await updatePasswordForRecoverySession(password, confirmPassword);
      if (result) {
        setError(result.error);
        setErrorField(result.field ?? null);
      }
    });
  }

  return (
    <div className="kivo-glass-brand w-full max-w-sm rounded-3xl p-6 sm:p-8">
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Choose a new password</h1>
          <p className="text-sm text-foreground-muted">
            You followed a reset link from your email. Pick a password and you&apos;re back in.
          </p>
        </header>

        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field label="New password" htmlFor="password" error={errorField === "password" ? error : null}>
            <PasswordInput
              id="password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              invalid={errorField === "password"}
              autoFocus
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

          <FormMessage error={errorField === null ? error : null} notice={null} />

          <SubmitButton pending={pending}>Set password and continue</SubmitButton>
        </form>

        <p className="text-center text-xs text-foreground-subtle">
          Link expired?{" "}
          <Link href="/forgot-password" className="font-medium text-accent transition-colors hover:text-foreground">
            Request a new code
          </Link>
        </p>
      </div>
    </div>
  );
}
