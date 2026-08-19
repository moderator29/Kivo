/**
 * Types, constants and pure validators shared by the auth Server Actions
 * (src/lib/auth-actions.ts) and the client forms that call them
 * (src/components/auth/*).
 *
 * They live in their own module because a `"use server"` file may only export
 * async functions — a plain `export const` in there is a build error — and
 * because the client bundle must not pull in anything `server-only`.
 *
 * Every validator here is pure and imported by BOTH sides. That is the point:
 * the server action is the boundary and re-runs all of them on data it does not
 * trust, while the form runs the identical function so the rule the user is
 * shown before they submit is literally the rule that will judge them after.
 * There is no second copy of "at least 10 characters" to drift.
 */

/** Which page the form is rendered on. Decides whether an unknown email is
 *  turned into a new account or rejected. */
export type AuthMode = "sign-in" | "sign-up";

/** Failure shape returned by the auth actions. Success never returns — it
 *  redirects. */
export type AuthActionResult = {
  error: string;
  /** Seconds the caller must wait before retrying, when the server told us. */
  retryAfterSeconds?: number;
  /** Set when the failure belongs to one named field, so the form can mark that
   *  field invalid rather than only printing a sentence under the button. */
  field?: SignUpField;
};

/** The fields of the pre-verification sign-up form, in the order they appear. */
export type SignUpField = "email" | "fullName" | "username" | "password" | "confirmPassword" | "country" | "agreed";

/**
 * How long "Resend code" stays disabled for. Matches Supabase's default
 * per-email OTP interval, so the button re-enables at roughly the moment the
 * server would actually accept another request. The server overrides it
 * whenever it reports a longer wait.
 */
export const RESEND_COOLDOWN_SECONDS = 60;

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Usernames are stored lowercased and trimmed in a `citext` column with a
 * UNIQUE constraint and a 3-24 character CHECK (see the `profiles_username_key`
 * and `profiles_username_length` constraints on the live table). This pattern
 * is the app's own narrower rule on top of that.
 */
export const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;

/**
 * Fold a typed handle into exactly the string that will be stored, as the user
 * types it.
 *
 * This is not cosmetic. A previous bug reported "Available" for `Puffnutz_`
 * (correctly — `puffnutz_` was free) while the input's own `pattern` silently
 * blocked submit with the browser's useless "Match the requested format". The
 * fix is not a better error message, it is removing the invalid state: show the
 * user the exact string that will be saved and there is nothing to report.
 */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** `profiles_display_name_length`: 1-40 characters when present. */
export const FULL_NAME_MIN = 1;
export const FULL_NAME_MAX = 40;

/**
 * KIVO's password policy, stated once, here.
 *
 * Ten characters rather than Supabase's default six: six is below every current
 * public guideline and this is the only credential on the account. A letter and
 * a digit are required because length alone lets `aaaaaaaaaa` through, and the
 * check costs the user nothing they would not have typed anyway. The ceiling is
 * not arbitrary either — bcrypt truncates at 72 **bytes**, so anything past it
 * is silently not part of the password, and a limit the user is told about is
 * better than a limit that quietly ignores their last characters.
 *
 * Deliberately NOT required: symbols, mixed case, and rotation. All three push
 * users towards one memorable pattern with a `!` on the end, and none of them
 * is what stops the attack that actually matters here — credential stuffing,
 * which is answered by the rate limits in auth-actions.ts and by Supabase's
 * leaked-password check (a founder action, see docs/DEPLOYING.md).
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_BYTES = 72;

/** The rules, in the words the form shows before anybody types anything. */
export const PASSWORD_RULES = [
  `At least ${PASSWORD_MIN_LENGTH} characters`,
  "At least one letter",
  "At least one number",
] as const;

export type PasswordCheck = {
  longEnough: boolean;
  hasLetter: boolean;
  hasNumber: boolean;
  /** Bcrypt truncates past 72 bytes; an over-long password is rejected, not trimmed. */
  withinByteLimit: boolean;
};

export function checkPassword(password: string): PasswordCheck {
  return {
    longEnough: password.length >= PASSWORD_MIN_LENGTH,
    hasLetter: /\p{L}/u.test(password),
    hasNumber: /\p{Nd}/u.test(password),
    withinByteLimit: new TextEncoder().encode(password).length <= PASSWORD_MAX_BYTES,
  };
}

export function isPasswordAcceptable(password: string): boolean {
  const check = checkPassword(password);
  return check.longEnough && check.hasLetter && check.hasNumber && check.withinByteLimit;
}

/** The single sentence a rejected password gets. Never lists which rule the
 *  attacker's candidate satisfied — but for a user, the live checklist above
 *  the button has already told them exactly which one is missing. */
export function describePasswordProblem(password: string): string | null {
  const check = checkPassword(password);
  if (!check.withinByteLimit) {
    return `Passwords can be at most ${PASSWORD_MAX_BYTES} characters.`;
  }
  if (check.longEnough && check.hasLetter && check.hasNumber) return null;
  return `Your password needs at least ${PASSWORD_MIN_LENGTH} characters, including a letter and a number.`;
}

/** Nigeria. The launch market, and the form's preselected country. */
export const DEFAULT_COUNTRY_CODE = "NG";

/**
 * What the sign-up form posts. Named rather than positional because six
 * same-typed strings in a row is a bug waiting to be written, and because the
 * server re-validates every one of these from scratch — nothing here is
 * trusted just because the client sent it.
 */
export type SignUpInput = {
  email: string;
  fullName: string;
  username: string;
  password: string;
  confirmPassword: string;
  /** ISO 3166-1 alpha-2. Stored as the code, never the display name. */
  country: string;
  /** The Privacy Policy / Terms checkbox. Unchecked by default; blocks submit. */
  agreed: boolean;
};

/** Answer of the live username check. `null` means "could not tell" — a
 *  distinct state from taken, and the UI must stay silent rather than guess. */
export type UsernameAvailability = { available: boolean | null };
