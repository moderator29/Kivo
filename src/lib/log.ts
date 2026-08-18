/**
 * Structured error logging (RECOMMENDATIONS.md item 204).
 *
 * Every failure path in this codebase currently calls `console.error` with
 * an ad-hoc message and whatever error object happened to be in scope. That
 * works for local dev but is close to write-only once deployed: there's no
 * consistent shape to grep/filter on and no way to correlate a failure with
 * the request or entity that caused it.
 *
 * This is NOT a Sentry/APM integration -- setting one up needs a real
 * account and credentials, neither of which exist in this sandbox. Faking
 * that integration (e.g. a Sentry-shaped call that silently no-ops) would be
 * worse than not having it: it would look wired up without ever reporting
 * anything. What this does instead is the smallest honest step available
 * without those credentials: give every error log a consistent, structured
 * shape now (timestamp, a short context tag, the error's message/stack, and
 * whatever ids are relevant) so structured log search already works against
 * stdout/stderr (which Vercel and most serverless hosts already capture),
 * and so wiring in a real APM tool later is a matter of adding a sink here
 * rather than revisiting every call site again.
 *
 * Next step once credentials exist: point this at Sentry.captureException
 * (or equivalent) in addition to (or instead of) the console.error sink
 * below, keeping this function's signature so call sites don't change.
 */

export type LogMetadata = Record<string, string | number | boolean | null | undefined>;

function serializeError(error: unknown): { errorMessage: string; errorName?: string; stack?: string } {
  if (error instanceof Error) {
    return { errorMessage: error.message, errorName: error.name, stack: error.stack };
  }
  return { errorMessage: typeof error === "string" ? error : JSON.stringify(error) };
}

/**
 * Logs a failure with a consistent, structured shape: ISO timestamp, a
 * short `context` tag identifying where it happened (e.g.
 * "fantasy.setGameweekRoster", "football.syncTodayFixtures"), the error's
 * message/name/stack, and any caller-supplied metadata (profile id, fixture
 * id, etc.) so a log search can filter by them.
 *
 * Deliberately a thin wrapper over `console.error`, not a new transport --
 * see the module doc comment above for why.
 */
export function logError(context: string, error: unknown, metadata?: LogMetadata): void {
  const entry = {
    timestamp: new Date().toISOString(),
    context,
    ...serializeError(error),
    ...metadata,
  };
  console.error(JSON.stringify(entry));
}
