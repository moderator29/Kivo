/**
 * Where "what time is it for this user" is answered, once, for the whole app.
 *
 * `profiles.timezone` (migration 0054) is the only input. It is nullable and
 * frequently null, because KIVO never infers a zone from an IP address — the
 * user tells us, or we do not know. So every function here takes the profile's
 * raw column value and returns a resolution that says *both* which zone to use
 * *and* whether that zone is something the user actually stated. A surface that
 * shows a date computed from the fallback is expected to be able to say so
 * ("times shown in UTC"), which is the same honesty rule the rest of the
 * product applies to unsynced football data.
 *
 * This module deliberately does not format anything. `src/lib/format.ts` owns
 * formatting and already accepts an explicit `timeZone` on every function that
 * needs one; this module's job is to decide what to pass it.
 */

/**
 * What a viewer with no stated timezone gets. UTC rather than the server's own
 * zone: a server's zone is an accident of deployment, and picking it would make
 * the same user see different day boundaries depending on which region rendered
 * their request.
 */
export const FALLBACK_TIME_ZONE = "UTC";

export type ResolvedTimeZone = {
  /** An IANA zone name safe to hand to `Intl` / `formatDateTime`. */
  timeZone: string;
  /**
   * True only when the user actually told us. False means `timeZone` is
   * `FALLBACK_TIME_ZONE` and the UI should be willing to admit it rather than
   * present a UTC timestamp as if it were the reader's local time.
   */
  isStated: boolean;
};

/**
 * Whether this runtime's ICU data actually knows the zone. Used to validate
 * user input before it reaches the database (where migration 0054's trigger
 * enforces the same rule against `pg_timezone_names`) and to defend against a
 * stored value this Node build cannot resolve — an unknown zone passed to
 * `Intl.DateTimeFormat` throws a RangeError, which would otherwise turn one bad
 * profile row into a crashed page render.
 */
export function isSupportedTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Resolves the zone to use for a viewer, given their `profiles.timezone`. */
export function resolveTimeZone(profileTimeZone: string | null | undefined): ResolvedTimeZone {
  if (typeof profileTimeZone === "string" && profileTimeZone.length > 0 && isSupportedTimeZone(profileTimeZone)) {
    return { timeZone: profileTimeZone, isStated: true };
  }
  return { timeZone: FALLBACK_TIME_ZONE, isStated: false };
}

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const PART_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function partFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = PART_FORMATTER_CACHE.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  PART_FORMATTER_CACHE.set(timeZone, formatter);
  return formatter;
}

/** The wall-clock reading a person in `timeZone` would see at `instant`. */
function wallClockIn(timeZone: string, instant: Date): WallClock {
  const parts = partFormatter(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") % 24, // some ICU builds report midnight as hour 24
    minute: read("minute"),
    second: read("second"),
  };
}

/** Milliseconds `timeZone` is ahead of UTC at `instant` (negative when behind). */
function offsetMsAt(timeZone: string, instant: Date): number {
  const w = wallClockIn(timeZone, instant);
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  // Milliseconds are not in the formatted parts, so they must be added back or
  // the offset would be wrong by up to 999ms for any non-whole-second instant.
  return asIfUtc - (instant.getTime() - instant.getUTCMilliseconds());
}

/**
 * The instant at which the calendar day containing `instant` began, for someone
 * in `timeZone`. This is the honest version of "since midnight" / "today" —
 * every date-bucketed feature (a streak, a daily digest, "today's fixtures")
 * needs a real boundary rather than the server's own midnight.
 *
 * Computed in two passes because a zone's offset is itself a function of the
 * instant: the first pass finds a candidate midnight using the offset in force
 * *now*, the second re-reads the offset at that candidate. That is what makes
 * this correct across a DST transition, where the offset at 13:00 and the
 * offset at 00:00 on the same date are different numbers.
 */
export function startOfDayInTimeZone(timeZone: string, instant: Date = new Date()): Date {
  const w = wallClockIn(timeZone, instant);
  const midnightAsIfUtc = Date.UTC(w.year, w.month - 1, w.day, 0, 0, 0);
  const firstPass = midnightAsIfUtc - offsetMsAt(timeZone, instant);
  const secondPass = midnightAsIfUtc - offsetMsAt(timeZone, new Date(firstPass));
  return new Date(secondPass);
}

/**
 * `YYYY-MM-DD` for the calendar day `instant` falls on in `timeZone`. The key a
 * per-day aggregate should group on — never `toISOString().slice(0, 10)`, which
 * silently groups by UTC days and puts a 23:30 Lagos kickoff on the wrong date
 * for the person who watched it.
 */
export function dayKeyInTimeZone(timeZone: string, instant: Date = new Date()): string {
  const w = wallClockIn(timeZone, instant);
  return `${String(w.year).padStart(4, "0")}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

/**
 * A short label for the zone as it stands right now — "GMT+1", "GMT-4". Shown
 * next to a stated timezone in Settings so the user can sanity-check that the
 * zone we hold matches the clock they are looking at. Returns null rather than
 * a guess if the runtime will not produce one.
 */
export function timeZoneOffsetLabel(timeZone: string, instant: Date = new Date()): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "shortOffset" }).formatToParts(instant);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? null;
  } catch {
    return null;
  }
}
