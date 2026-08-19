"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Mail } from "lucide-react";
import { signInWithPassword } from "@/lib/auth-actions";
import type { SignUpField } from "@/lib/auth-shared";
import { EmailCodeForm } from "./email-code-form";
import { Field, FIELD_CLASS, FormMessage, PasswordInput, SubmitButton } from "./auth-form-parts";

/**
 * The front door: email and password.
 *
 * TWO WAYS IN, ONE OF THEM SECONDARY. The password form is what loads; the
 * six-digit code is behind an explicit "Email me a code instead" control. Both
 * are kept on purpose and the reasoning is written down in DECISIONS.md and at
 * the top of email-code-form.tsx — briefly: every account that predates
 * passwords has none, including the only real one on the platform, so removing
 * the code path the night passwords arrive would leave that person's ability to
 * sign in resting entirely on a reset email arriving. They share this file's
 * primitives and both run through the same Server Actions, so neither is the
 * half-maintained one.
 *
 * Nothing in this component is a security check. `signInWithPassword` in
 * src/lib/auth-actions.ts re-validates and rate-limits, and it returns one
 * message for a wrong password and for an address with no account — a sign-in
 * form that distinguishes them is a membership oracle.
 */
export function SignInForm({ redirectTo, addAccount = false }: { redirectTo?: string; addAccount?: boolean }) {
  const [method, setMethod] = useState<"password" | "code">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<SignUpField | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setErrorField(null);
    startTransition(async () => {
      // Only returns on failure — success redirects out of this page entirely.
      const result = await signInWithPassword(email, password, redirectTo, addAccount);
      if (result) {
        setError(result.error);
        setErrorField(result.field ?? null);
      }
    });
  }

  return (
    <div className="kivo-glass-brand w-full max-w-sm rounded-3xl p-6 sm:p-8">
      <AnimatePresence mode="wait" initial={false}>
        {method === "code" ? (
          <EmailCodeForm
            key="code"
            redirectTo={redirectTo}
            addAccount={addAccount}
            onUsePassword={() => setMethod("password")}
          />
        ) : (
          <motion.div
            key="password"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.18 }}
            className="flex flex-col gap-5"
          >
            <header className="flex flex-col gap-1.5 text-center">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {addAccount ? "Add another account" : "Welcome back"}
              </h1>
              <p className="text-sm text-foreground-muted">
                {addAccount
                  ? "Sign in to the account you want to add. You'll stay signed in to the one you're using until this one is."
                  : "Sign in with your email and password."}
              </p>
            </header>

            <form onSubmit={submit} noValidate className="flex flex-col gap-4">
              <Field label="Email address" htmlFor="email" error={errorField === "email" ? error : null}>
                <div className="relative">
                  <Mail
                    strokeWidth={1.75}
                    className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle"
                    aria-hidden="true"
                  />
                  <input
                    id="email"
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
              </Field>

              <Field label="Password" htmlFor="password" error={errorField === "password" ? error : null}>
                <PasswordInput
                  id="password"
                  value={password}
                  onChange={setPassword}
                  autoComplete="current-password"
                  invalid={errorField === "password"}
                />
              </Field>

              <FormMessage error={errorField === null ? error : null} notice={null} />

              <SubmitButton pending={pending}>Sign in</SubmitButton>
            </form>

            <div className="flex flex-col items-center gap-2 text-xs">
              <Link href="/forgot-password" className="font-medium text-accent transition-colors hover:text-foreground">
                Forgot password?
              </Link>
              {/* The second door, named plainly. Also the answer for anybody
                  whose account predates passwords and therefore has none. */}
              <button
                type="button"
                onClick={() => {
                  setMethod("code");
                  setError(null);
                  setErrorField(null);
                }}
                className="inline-flex items-center gap-1.5 text-foreground-subtle transition-colors hover:text-foreground-muted"
              >
                <Mail strokeWidth={2} className="h-3.5 w-3.5" aria-hidden="true" />
                Email me a 6-digit code instead
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
