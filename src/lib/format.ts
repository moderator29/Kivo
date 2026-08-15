/** Compact relative-time label ("just now", "5m", "3h", "2d") for a
 * timestamp already close to now — used on social posts and notifications.
 * Was defined identically in both places before this was consolidated.
 * Beyond 30 days this switches to a real date (e.g. "14 Aug" / "14 Aug 2025"
 * across a year boundary) rather than an ever-growing day count. */
export function timeAgo(isoDate: string): string {
  const date = new Date(isoDate);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: sameYear ? undefined : "numeric" });
}

/** Whole-years-old age from a date of birth, as of right now. Was defined
 * identically on `teams/[id]` and `players/[id]` before this was
 * consolidated. */
export function calculateAge(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

/** Short clock time ("2:41 PM") for a timestamp already known to be recent —
 * used on AI Copilot chat messages, where "5m ago"-style relative labels
 * would need to keep re-rendering to stay accurate as the user reads. */
export function formatClockTime(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Long-form date ("14 August 2026") by default — pass `{ month: "short" }`
 * for the abbreviated form transfers uses ("14 Aug 2026"). Both were
 * near-identical standalone `formatDate` functions (`players/[id]` and
 * `transfers/page.tsx`) before this was consolidated; each call site keeps
 * its previous exact output. */
export function formatDate(value: string, options: { month?: "numeric" | "2-digit" | "long" | "short" | "narrow" } = {}): string {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: options.month ?? "long",
    day: "numeric",
  });
}

/** Compact euro amount ("€45.0M", "€850K") for a real vendor-reported market
 * value (players.market_value_eur, supabase/migrations/0036) — never called
 * on an estimated/derived figure. Whole euros in, compact label out. */
export function formatMarketValueEur(valueEur: number): string {
  if (valueEur >= 1_000_000) return `€${(valueEur / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (valueEur >= 1_000) return `€${Math.round(valueEur / 1_000)}K`;
  return `€${valueEur}`;
}
