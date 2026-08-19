"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { checkUsernameAvailability, sendEmailCode, signUpWithPassword, verifyEmailCode } from "@/lib/auth-actions";
import {
  DEFAULT_COUNTRY_CODE,
  RESEND_COOLDOWN_SECONDS,
  USERNAME_MAX,
  USERNAME_PATTERN,
  normalizeUsername,
  type SignUpField,
} from "@/lib/auth-shared";
import { CodeInput, Field, FIELD_CLASS, FormMessage, PasswordInput, PasswordRules, SubmitButton } from "./auth-form-parts";

/**
 * KIVO's sign-up, as the founder specified it: full name, username, password,
 * confirm password, country and an explicit agreement to the Privacy Policy and
 * Terms — all of it BEFORE the account exists — then Supabase's verification
 * code.
 *
 * The point of collecting identity up front is not tidiness. It is that a
 * handle picked after verification used to be picked in a flow the user could
 * abandon halfway, leaving a real `auth.users` row with a machine-generated
 * `user_a1b2c3d4e5` handle behind it; and it means the post-verification
 * onboarding no longer has to ask for something the person has already given.
 *
 * Everything visible here is re-checked in `signUpWithPassword`
 * (src/lib/auth-actions.ts). This form is convenience; that function is the
 * boundary.
 */

const AVAILABILITY_DEBOUNCE_MS = 450;

type Availability = "idle" | "checking" | "available" | "taken";

export function SignUpForm({
  countries,
  redirectTo,
  addAccount = false,
}: {
  /**
   * The country list, built ON THE SERVER and passed down — see
   * src/app/sign-up/page.tsx.
   *
   * It used to be computed here with `getSortedCountries()`, and that was a real
   * bug, caught in a browser: `Intl.DisplayNames` and `localeCompare` resolve
   * against whichever ICU data the runtime carries, and Node's is not the
   * browser's. The two produced different labels and a different order, React
   * reported "Hydration failed because the server rendered text didn't match the
   * client", and it threw away and re-rendered the tree. On a slow phone that is
   * indistinguishable from the founder's report that the button "isn't
   * clicking" — a form whose hydration keeps failing is a form whose controls
   * are dead. Rendering the list once, on the server, removes the disagreement
   * rather than papering over it.
   */
  countries: { code: string; name: string }[];
  redirectTo?: string;
  addAccount?: boolean;
}) {
  const [step, setStep] = useState<"details" | "code">("details");

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [country, setCountry] = useState(DEFAULT_COUNTRY_CODE);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreed, setAgreed] = useState(false);

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<SignUpField | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [pending, startTransition] = useTransition();

  const [availability, setAvailability] = useState<Availability>("idle");
  const availabilityRequestId = useRef(0);
  const debounceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (step === "code") codeInputRef.current?.focus();
  }, [step]);

  // Only cleans up the pending timer on unmount — never calls setState, so this
  // does not trip React's "don't derive state in an effect" rule.
  useEffect(() => () => {
    if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
  }, []);

  /**
   * Normalise as the user types rather than validating after the fact.
   *
   * The server stores `username.trim().toLowerCase()` and the availability
   * check lowercases too — so typing "Puffnutz_" used to report "Available"
   * (correctly: `puffnutz_` was free) while the input's own `pattern` silently
   * blocked submit with the browser's useless "Match the requested format".
   * Folding the case on the way in removes the contradiction entirely: there is
   * no invalid state left to report, because what is shown is exactly what will
   * be saved.
   *
   * Debounced from this handler rather than from a `username` effect: an effect
   * would have to call setAvailability("idle") synchronously for an invalid
   * candidate, which is the derive-state-in-an-effect anti-pattern. Driving it
   * from the event keeps every setAvailability call inside a callback.
   */
  function handleUsernameChange(raw: string) {
    const value = normalizeUsername(raw).slice(0, USERNAME_MAX);
    setUsername(value);
    if (debounceTimeout.current) clearTimeout(debounceTimeout.current);

    if (!USERNAME_PATTERN.test(value)) {
      setAvailability("idle");
      return;
    }

    setAvailability("checking");
    const requestId = ++availabilityRequestId.current;
    debounceTimeout.current = setTimeout(() => {
      checkUsernameAvailability(value).then((result) => {
        // A newer keystroke may already have kicked off another check — ignore a
        // stale response landing after it so the indicator never flickers back
        // to an outdated candidate.
        if (availabilityRequestId.current !== requestId) return;
        setAvailability(result.available === null ? "idle" : result.available ? "available" : "taken");
      });
    }, AVAILABILITY_DEBOUNCE_MS);
  }

  function fail(message: string, field: SignUpField | null) {
    setError(message);
    setErrorField(field);
  }

  function submitDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setErrorField(null);
    setNotice(null);

    startTransition(async () => {
      const result = await signUpWithPassword(
        { email, fullName, username, password, confirmPassword, country, agreed },
        redirectTo,
      );
      if (result) {
        fail(result.error, result.field ?? null);
        if (result.retryAfterSeconds) setCooldown(result.retryAfterSeconds);
        return;
      }
      setStep("code");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    });
  }

  function submitCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setErrorField(null);
    setNotice(null);
    startTransition(async () => {
      // Only returns on failure — success redirects out of this page entirely.
      const result = await verifyEmailCode(email, code, redirectTo, addAccount);
      if (result) fail(result.error, result.field ?? null);
    });
  }

  /**
   * Resend. Goes through `sendEmailCode`, not through `signUpWithPassword`
   * again: by this point the account exists (unconfirmed), so re-running signup
   * would be a second creation attempt rather than a second email. `sendEmailCode`
   * cannot create an account, which is precisely why it is the right call here.
   */
  function resendCode() {
    setError(null);
    setErrorField(null);
    setNotice(null);
    startTransition(async () => {
      const result = await sendEmailCode(email, "sign-up", redirectTo);
      if (result) {
        fail(result.error, result.field ?? null);
        if (result.retryAfterSeconds) setCooldown(result.retryAfterSeconds);
        return;
      }
      setCode("");
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setNotice("New code sent. Check your inbox.");
    });
  }

  const usernameValid = USERNAME_PATTERN.test(username);

  return (
    <div className="kivo-glass-brand w-full max-w-sm rounded-3xl p-6 sm:p-8">
      <AnimatePresence mode="wait" initial={false}>
        {step === "details" ? (
          <motion.div
            key="details"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.18 }}
            className="flex flex-col gap-5"
          >
            <header className="flex flex-col gap-1.5 text-center">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {addAccount ? "Create another account" : "Create your KIVO account"}
              </h1>
              <p className="text-sm text-foreground-muted">
                {addAccount
                  ? "You'll stay signed in to the account you're using until this one is verified."
                  : "Everything we need, in one go. We'll email you a 6-digit code to confirm it's you."}
              </p>
            </header>

            <form onSubmit={submitDetails} noValidate className="flex flex-col gap-4">
              <Field label="Email address" htmlFor="email" error={errorField === "email" ? error : null}>
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
                  className={FIELD_CLASS}
                />
              </Field>

              <Field label="Full name" htmlFor="fullName" error={errorField === "fullName" ? error : null}>
                <input
                  id="fullName"
                  name="fullName"
                  type="text"
                  autoComplete="name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Ada Obi"
                  maxLength={40}
                  aria-invalid={errorField === "fullName" ? true : undefined}
                  className={FIELD_CLASS}
                />
              </Field>

              <Field
                label="Username"
                htmlFor="username"
                error={errorField === "username" ? error : null}
                hint={<UsernameHint username={username} valid={usernameValid} availability={availability} />}
              >
                <div className="relative">
                  <span
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base text-foreground-subtle"
                    aria-hidden="true"
                  >
                    @
                  </span>
                  <input
                    id="username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={username}
                    onChange={(event) => handleUsernameChange(event.target.value)}
                    placeholder="adaobi"
                    aria-invalid={errorField === "username" || availability === "taken" ? true : undefined}
                    className={`${FIELD_CLASS} pl-8 pr-11`}
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2">
                    {availability === "checking" ? (
                      <Loader2 strokeWidth={1.75} className="h-4 w-4 animate-spin text-foreground-subtle" aria-hidden="true" />
                    ) : availability === "available" ? (
                      <Check strokeWidth={1.75} className="h-4 w-4 text-live" aria-hidden="true" />
                    ) : null}
                  </span>
                </div>
              </Field>

              {/* ISO 3166-1 alpha-2 codes from src/lib/countries.ts, whose list
                  is pinned to the `profiles_country_format` CHECK constraint on
                  the live table, with display names derived at render time from
                  Intl.DisplayNames rather than a hand-typed name list. The value
                  stored is the code, never the label, so a country being renamed
                  or the page being translated cannot orphan a profile. */}
              <Field label="Country" htmlFor="country" error={errorField === "country" ? error : null}>
                <select
                  id="country"
                  name="country"
                  autoComplete="country"
                  value={country}
                  onChange={(event) => setCountry(event.target.value)}
                  aria-invalid={errorField === "country" ? true : undefined}
                  className={FIELD_CLASS}
                >
                  {countries.map((entry) => (
                    <option key={entry.code} value={entry.code}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Password" htmlFor="password" error={errorField === "password" ? error : null}>
                <PasswordInput
                  id="password"
                  value={password}
                  onChange={setPassword}
                  autoComplete="new-password"
                  invalid={errorField === "password"}
                />
              </Field>
              {/* The rules, before submission rather than after rejection. */}
              <PasswordRules password={password} />

              <Field
                label="Confirm password"
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

              {/* A real control, unchecked by default, checked again on the
                  server. Both documents exist as routes, and both open in a new
                  tab so reading them does not throw away a half-filled form. */}
              <label
                htmlFor="agreed"
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-xs transition-colors ${
                  errorField === "agreed" ? "border-critical bg-critical/5" : "border-hairline bg-surface-inset"
                }`}
              >
                <input
                  id="agreed"
                  name="agreed"
                  type="checkbox"
                  checked={agreed}
                  onChange={(event) => setAgreed(event.target.checked)}
                  aria-invalid={errorField === "agreed" ? true : undefined}
                  className="kivo-focusable mt-0.5 h-5 w-5 shrink-0 accent-[var(--kivo-cyan,#22d3ee)]"
                />
                <span className="text-foreground-muted">
                  I agree to KIVO&apos;s{" "}
                  <Link
                    href="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-accent underline underline-offset-2 transition-colors hover:text-foreground"
                  >
                    Privacy Policy
                  </Link>{" "}
                  and{" "}
                  <Link
                    href="/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-accent underline underline-offset-2 transition-colors hover:text-foreground"
                  >
                    Terms of Service
                  </Link>
                  .
                </span>
              </label>

              {/* Only shown when the failure does not belong to one named field
                  — a field-level failure is printed under that field instead, so
                  the same sentence never appears twice. */}
              <FormMessage error={errorField === null ? error : null} notice={notice} />

              <SubmitButton pending={pending}>Create account</SubmitButton>
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

            <form onSubmit={submitCode} noValidate className="flex flex-col gap-3">
              <CodeInput value={code} onChange={setCode} invalid={Boolean(error)} inputRef={codeInputRef} />
              <FormMessage error={error} notice={notice} />
              <SubmitButton pending={pending}>Verify and continue</SubmitButton>
            </form>

            <div className="flex flex-col items-center gap-2 text-xs">
              <button
                type="button"
                disabled={pending || cooldown > 0}
                onClick={resendCode}
                className="font-medium text-accent transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:text-foreground-subtle"
              >
                {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setStep("details");
                  setCode("");
                  setError(null);
                  setErrorField(null);
                  setNotice(null);
                }}
                className="inline-flex items-center gap-1 text-foreground-subtle transition-colors hover:text-foreground-muted disabled:opacity-50"
              >
                <ArrowLeft strokeWidth={2} className="h-3 w-3" aria-hidden="true" />
                Change my details
              </button>
            </div>

            {/* The honest escape hatches, in the order a stuck user needs them.
                The second one is load-bearing and deliberately unconditional:
                signing up with an address that ALREADY has a KIVO account is
                answered by Supabase with an obfuscated success and no email at
                all, because saying "that address is taken" would be exactly the
                membership oracle /sign-in refuses to be (DECISIONS.md). Nobody
                is told which case they are in — everybody is told what to do
                about it. */}
            <div className="flex flex-col gap-2 border-t border-hairline-soft pt-4 text-center text-xs text-foreground-subtle">
              <p>
                No code in the email? Tap the <span className="text-foreground-muted">Confirm my email</span> link in it
                instead — that confirms you too.
              </p>
              <p>
                Nothing arrived at all? That address may already have a KIVO account.{" "}
                <Link href="/sign-in" className="font-medium text-accent transition-colors hover:text-foreground">
                  Sign in instead
                </Link>
                .
              </p>
              <p>
                Still stuck?{" "}
                <Link href="/support?topic=sign_in" className="font-medium text-accent transition-colors hover:text-foreground">
                  Get help
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
 * The line under the username box.
 *
 * Four states, and the fourth is the one that matters: "could not tell". The
 * availability check needs the service-role key and its own rate-limit budget,
 * and when either is missing it answers `null` — which must render as silence,
 * not as a green tick. Claiming a handle is free when nobody asked the database
 * is exactly the kind of confident wrong answer this codebase refuses to give.
 */
function UsernameHint({
  username,
  valid,
  availability,
}: {
  username: string;
  valid: boolean;
  availability: Availability;
}) {
  if (username.length === 0) {
    return <>3-24 characters. Lowercase letters, numbers and underscores.</>;
  }
  if (!valid) {
    return <>3-24 characters. Lowercase letters, numbers and underscores.</>;
  }
  if (availability === "taken") {
    return <span className="text-critical">That username is taken. Try another.</span>;
  }
  if (availability === "available") {
    return <span className="text-live">@{username} is available.</span>;
  }
  return <>Checked against every KIVO handle before your account is created.</>;
}
