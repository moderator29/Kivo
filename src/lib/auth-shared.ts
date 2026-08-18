/**
 * Types and constants shared by the auth Server Actions
 * (src/lib/auth-actions.ts) and the client form that calls them
 * (src/components/auth/email-code-form.tsx).
 *
 * They live in their own module because a `"use server"` file may only export
 * async functions — a plain `export const` in there is a build error — and
 * because the client bundle must not pull in anything `server-only`.
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
};

/**
 * How long "Resend code" stays disabled for. Matches Supabase's default
 * per-email OTP interval, so the button re-enables at roughly the moment the
 * server would actually accept another request. The server overrides it
 * whenever it reports a longer wait.
 */
export const RESEND_COOLDOWN_SECONDS = 60;
