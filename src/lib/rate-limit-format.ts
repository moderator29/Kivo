/**
 * "45 seconds" / "about 4 minutes" / "about 2 hours" (KN-60).
 *
 * Its own module, free of `import "server-only"`, purely so it can be unit
 * tested — src/lib/rate-limit.ts is server-only by necessity (it holds the
 * service-role client) and re-exports this. Pure so the wording is tested
 * rather than eyeballed. Coarse on
 * purpose past a minute: a sliding window's exact expiry is a moving target the
 * moment the user reads it, and "about 4 minutes" stays true for longer than
 * "3 minutes 51 seconds" does.
 */
export function formatRetryAfter(seconds: number): string {
  const safe = Math.max(1, Math.ceil(seconds));
  if (safe < 60) return `${safe} second${safe === 1 ? "" : "s"}`;
  const minutes = Math.ceil(safe / 60);
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `about ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.ceil(hours / 24);
  return `about ${days} day${days === 1 ? "" : "s"}`;
}
