"use client";

import { useId, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Eye, EyeOff, Loader2, X } from "lucide-react";
import { PASSWORD_RULES, checkPassword } from "@/lib/auth-shared";

/**
 * The parts every KIVO auth screen is built from — sign-up, sign-in, the email
 * code, forgot-password and reset-password.
 *
 * They live in one file because four forms that look almost the same but are
 * built from four private copies of a field is exactly how an auth surface
 * drifts into "the password box on one screen behaves differently from the
 * password box on the next". One definition, five screens.
 */

export const FIELD_CLASS =
  "kivo-focusable w-full rounded-xl border border-hairline bg-surface-inset px-4 py-3.5 text-base text-foreground transition-colors placeholder:text-foreground-subtle focus:border-accent focus:outline-none";

/**
 * One live region for both halves of a form's feedback. `role="status"` rather
 * than `role="alert"` for the notice so a resend confirmation doesn't interrupt
 * a screen reader mid-sentence; the error is assertive because it blocks
 * progress.
 */
export function FormMessage({ error, notice }: { error: string | null; notice: string | null }) {
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

/**
 * THE SUBMIT BUTTON, AND WHY IT IS NEVER DISABLED FOR AN EMPTY FORM.
 *
 * The founder reported "sign in button it's not clicking", and it was real.
 * Every auth button here used to carry `disabled={email.trim().length === 0}`.
 * That expression is evaluated on the server too, where the field is always
 * empty — so the button was rendered `disabled` into the HTML and only became
 * clickable once React had hydrated and re-run the expression against typed
 * state. On a phone, on a slow connection, or on any request where a script
 * fails to load (the deployed CSP has blocked a script before), hydration never
 * lands, the controlled input never updates state, and the button stays dead
 * forever. Reproduced with JavaScript disabled: the submit control ships
 * `disabled` and nothing the user types can change that.
 *
 * "Disabled until valid" also fails the person it is meant to help even when it
 * works: a disabled button gives no reason. So the rule here is now: the button
 * is live from first paint, pressing it always does something, and an incomplete
 * form answers with a sentence naming the field. It is disabled only while a
 * request is genuinely in flight, which is the one case where a second press
 * would do harm.
 */
export function SubmitButton({ children, pending }: { children: React.ReactNode; pending: boolean }) {
  return (
    <motion.button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      whileHover={pending ? undefined : { scale: 1.02 }}
      whileTap={pending ? undefined : { scale: 0.97 }}
      className="kivo-gradient-prime flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-base font-semibold text-kivo-white shadow-[0_8px_30px_-8px_rgba(37,99,255,0.55)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60 disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? <Loader2 strokeWidth={1.75} className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </motion.button>
  );
}

/** A labelled text field. The label is visible rather than a placeholder-only
 *  affordance: on a phone the placeholder disappears the moment you type, and a
 *  six-field form where every filled box has lost its name is unusable. */
export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-foreground-muted">
        {label}
      </label>
      {children}
      {/* `role="alert"` because this is often the ONLY answer a submission gets:
          the button is never disabled for an incomplete form (see SubmitButton),
          so pressing it with an empty email replies here and nowhere else. A
          message that a screen reader never announces would leave exactly the
          user who most needs it pressing a button that appears to do nothing. */}
      {error ? (
        <p role="alert" className="text-xs text-critical">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-foreground-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * A password box with a reveal toggle.
 *
 * The toggle exists because the alternative on a phone keyboard is a user who
 * cannot see what they typed choosing a shorter, simpler password — which costs
 * more security than briefly showing it costs. `autoComplete` is passed in
 * rather than fixed: "new-password" tells a password manager to offer to
 * generate and save one, "current-password" tells it to fill; getting that
 * wrong is the difference between a manager helping and a manager fighting.
 */
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  placeholder,
  invalid,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "new-password" | "current-password";
  placeholder?: string;
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        name={id}
        type={shown ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-invalid={invalid ? true : undefined}
        autoFocus={autoFocus}
        className={`${FIELD_CLASS} pr-12`}
      />
      <button
        type="button"
        onClick={() => setShown((current) => !current)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        // 44px, not 40. back-link.tsx calls min-h-11 "the one non-negotiable
        // number on this project", and the show/hide toggle on a password
        // field is precisely the control a thumb misses.
        className="kivo-focusable absolute right-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-foreground-subtle transition-colors hover:text-foreground"
      >
        {shown ? (
          <EyeOff strokeWidth={1.75} className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Eye strokeWidth={1.75} className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

/**
 * The password rules, shown BEFORE anything is typed and ticked off live.
 *
 * Stated up front rather than as a rejection afterwards: a rule a user only
 * discovers by failing it is a rule the product kept to itself. The list is
 * generated from PASSWORD_RULES and evaluated by checkPassword — the same
 * function the Server Action uses — so what is displayed here cannot drift from
 * what is enforced there.
 */
export function PasswordRules({ password }: { password: string }) {
  const check = checkPassword(password);
  const met = [check.longEnough, check.hasLetter, check.hasNumber];

  return (
    <ul className="flex flex-col gap-1" aria-label="Password requirements">
      {PASSWORD_RULES.map((rule, index) => {
        const ok = met[index];
        return (
          <li key={rule} className="flex items-center gap-1.5 text-xs">
            {ok ? (
              <Check strokeWidth={2} className="h-3.5 w-3.5 shrink-0 text-live" aria-hidden="true" />
            ) : (
              <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-hairline" aria-hidden="true" />
            )}
            <span className={ok ? "text-foreground-muted" : "text-foreground-subtle"}>{rule}</span>
            <span className="sr-only">{ok ? " — met" : " — not met yet"}</span>
          </li>
        );
      })}
      {!check.withinByteLimit ? (
        <li className="flex items-center gap-1.5 text-xs text-critical">
          <X strokeWidth={2} className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Too long — 72 characters maximum.
        </li>
      ) : null}
    </ul>
  );
}

/**
 * The shared six-digit code step: sign-up verification and password reset both
 * land on one of these, and so does the email-code sign-in.
 *
 * Digits are stripped as they are typed so a pasted "123 456", or a code copied
 * out of a notification with a stray space, still works.
 */
export function CodeInput({
  value,
  onChange,
  invalid,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const id = useId();
  return (
    <>
      <label htmlFor={id} className="sr-only">
        6-digit code
      </label>
      <input
        id={id}
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="000000"
        aria-invalid={invalid ? true : undefined}
        className="kivo-focusable w-full rounded-xl border border-hairline bg-surface-inset px-4 py-3.5 text-center font-mono text-2xl tracking-[0.5em] text-foreground transition-colors placeholder:text-foreground-subtle/50 focus:border-accent focus:outline-none"
      />
    </>
  );
}
