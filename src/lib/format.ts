/**
 * Every date, time and number KIVO renders goes through this module, and
 * every one of them names its locale explicitly.
 *
 * Why that matters (docs/BUG_AUDIT_2026-08-18.md C5): passing `undefined` as
 * the locale means "use whatever locale this runtime defaults to". On the
 * server that is Node's default — effectively en-US — and in the browser it
 * is the visitor's. So a client component server-rendered as "Aug 14, 2026"
 * hydrated as "14 August 2026" for a UK, Nigerian or German visitor, React
 * threw a hydration error and threw away the server-rendered subtree. It also
 * meant the *same date* rendered two different ways in one app depending on
 * whether the component that showed it happened to be a Server or a Client
 * Component. Reproduced in a real browser: chromium with `locale: "en-GB"`
 * against a page of post cards logs "Hydration failed because the server
 * rendered text didn't match the client".
 *
 * en-GB is the pin, not en-US, because it is what this module's own doc
 * comments always claimed it produced ("14 August 2026", "14 Aug 2026",
 * "14 Aug 2025") — the American output was an accident of the server's
 * default locale, not anybody's intent — and because 24-hour kickoff times
 * are the football norm worldwide.
 *
 * Time *zones* are handled per value type, and the distinction is
 * load-bearing rather than pedantic:
 *
 * - A `date` column (transfers.transfer_date, players.date_of_birth) has no
 *   time and no zone. `new Date("2026-08-14")` is UTC midnight, so reading it
 *   back with local getters renders "13 Aug" for anyone west of Greenwich —
 *   a transfer that happened on the 14th displayed as the 13th, and (being a
 *   client component) a second hydration mismatch on top. Reproduced in
 *   chromium with `timezoneId: "America/New_York"`. These format in UTC, so
 *   the calendar date that came out of the database is the calendar date on
 *   screen, for everyone.
 *
 * - A `timestamptz` (kickoff_at, created_at) names a real instant, and the
 *   right thing to show is the viewer's own local time — which the server
 *   cannot know. Those render through <LocalDateTime> and <RelativeTime>
 *   (src/components/ui/relative-time.tsx), which resolve the zone after
 *   mount rather than guessing during SSR.
 */
export const DISPLAY_LOCALE = "en-GB";

/** Named `Intl.DateTimeFormat` option sets, so a component can ask for a
 * format by name instead of passing an object literal that changes identity
 * on every render (and so two call sites showing "the same thing" cannot
 * quietly drift apart). */
export const DATE_TIME_FORMATS = {
  /** "10:30" — a time of day on its own. */
  clock: { hour: "numeric", minute: "2-digit" },
  /** "10:30" — zero-padded; used for kickoff times in dense lists. */
  time: { hour: "2-digit", minute: "2-digit" },
  /** "Sat, 10:30" */
  weekdayTime: { weekday: "short", hour: "2-digit", minute: "2-digit" },
  /** "14 Aug, 10:30" */
  dayTime: { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
  /** "14 Aug 2026, 10:30" */
  full: { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
  /** "Sat, 14 Aug, 10:30" — a fantasy/prediction deadline. */
  deadline: { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

export type DateTimeFormatName = keyof typeof DATE_TIME_FORMATS;

/** Formats a real instant. `timeZone` is explicit on purpose: pass "UTC" for
 * a server render that must be reproducible, and leave it out only where the
 * result is allowed to depend on the machine doing the formatting. */
export function formatDateTime(isoDate: string, format: DateTimeFormatName, timeZone?: string): string {
  return new Date(isoDate).toLocaleString(DISPLAY_LOCALE, {
    ...DATE_TIME_FORMATS[format],
    ...(timeZone ? { timeZone } : {}),
  });
}

/** Compact relative-time label ("just now", "5m", "3h", "2d") for a
 * timestamp already close to now — used on social posts and notifications.
 * Was defined identically in both places before this was consolidated.
 * Beyond 30 days this switches to a real date (e.g. "14 Aug" / "14 Aug 2025"
 * across a year boundary) rather than an ever-growing day count.
 *
 * `now` is injectable so the caller controls the clock: <RelativeTime> passes
 * a ticking value to keep the label current after mount, and tests can pin it.
 * Rendered directly (rather than through <RelativeTime>) this is only safe in
 * a Server Component, where there is no hydration pass to disagree with. */
export function timeAgo(isoDate: string, now: number = Date.now()): string {
  const date = new Date(isoDate);
  const seconds = Math.floor((now - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const sameYear = date.getUTCFullYear() === new Date(now).getUTCFullYear();
  return date.toLocaleDateString(DISPLAY_LOCALE, {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC",
  });
}

/** Whole-years-old age from a date of birth, as of right now. Was defined
 * identically on `teams/[id]` and `players/[id]` before this was
 * consolidated. `date_of_birth` is a `date` column, so every part of this
 * reads in UTC — with local getters, a birthday could land a day early or
 * late purely because of where the reader is sitting. */
export function calculateAge(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

/** Short clock time ("14:41") for a timestamp already known to be recent —
 * used on AI Copilot chat messages, where "5m ago"-style relative labels
 * would need to keep re-rendering to stay accurate as the user reads.
 *
 * This is a real instant, so it is shown in the viewer's own zone. That makes
 * it unsafe to render directly during SSR — use <LocalDateTime format="clock">
 * in a Client Component. */
export function formatClockTime(isoDate: string, timeZone?: string): string {
  return formatDateTime(isoDate, "clock", timeZone);
}

/** Long-form date ("14 August 2026") by default — pass `{ month: "short" }`
 * for the abbreviated form transfers uses ("14 Aug 2026"). Both were
 * near-identical standalone `formatDate` functions (`players/[id]` and
 * `transfers/page.tsx`) before this was consolidated.
 *
 * For `date` columns only (transfer_date, date_of_birth): formatted in UTC so
 * the calendar date stored is the calendar date shown, everywhere. */
export function formatDate(value: string, options: { month?: "numeric" | "2-digit" | "long" | "short" | "narrow" } = {}): string {
  return new Date(value).toLocaleDateString(DISPLAY_LOCALE, {
    year: "numeric",
    month: options.month ?? "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Grouped number ("12,480"). Same reasoning as the dates above: a bare
 * `.toLocaleString()` in a Client Component is a hydration mismatch waiting
 * for a visitor whose locale groups with dots or spaces. */
export function formatNumber(value: number): string {
  return value.toLocaleString(DISPLAY_LOCALE);
}

/** Compact "time left" label ("2d 3h", "5h 30m", "45m") for an instant that
 * is still in the future, and `null` once it isn't — the caller decides what
 * "passed" reads as, because that differs by surface (a fantasy deadline says
 * "Deadline passed"; a kickoff says the match is under way).
 *
 * Split out of fantasy's `formatDeadlineCountdown`, which now delegates to it,
 * so /home's lead slot counts down to a kickoff in exactly the same shape a
 * fantasy deadline counts down in — two clocks in one product that disagree on
 * whether 90 minutes is "1h 30m" or "90m" is the kind of small inconsistency
 * that makes an app feel assembled rather than designed.
 *
 * Locale-independent by construction (it emits its own d/h/m units rather than
 * going through Intl), so unlike the rest of this module it is safe to render
 * during SSR — though anything that has to keep ticking still needs a client
 * component to re-render it. */
export function formatDurationUntil(iso: string, now: Date | number = Date.now()): string | null {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const diffMs = new Date(iso).getTime() - nowMs;
  if (diffMs <= 0) return null;

  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
