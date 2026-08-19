/**
 * Quiet hours, evaluated in the user's own timezone.
 *
 * Pure and dependency-free on purpose: this decides whether somebody gets
 * interrupted, and a rule that decides that should be readable and testable
 * without a database or a clock.
 *
 * WHAT THE WINDOW IS. Two wall-clock times and a zone. The times carry no
 * offset (migration 0088 stores them as `time`, not `timestamptz`) because
 * "not after ten at night" is an intention about the clock on the wall, and it
 * stays true across a daylight-saving change precisely by not carrying an
 * offset. The offset arrives here, at evaluation time, from
 * `profiles.timezone`.
 *
 * A window whose end is earlier than its start crosses midnight. That is not
 * an edge case, it is the normal case — 22:00 to 07:00 is what quiet hours
 * usually are — so it is handled first rather than patched on.
 */

/** Minutes since local midnight, for an instant, in a given IANA zone.
 *
 * `Intl` is the only timezone database available here, and it is a real one:
 * asking it to format an instant in a zone gives the wall-clock time in that
 * zone, DST included, without shipping a zone table. */
function localMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);

  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  // Intl renders midnight as "24" in some locales/engines; normalise so
  // midnight is 0 rather than a value a day out of range.
  return (hour % 24) * 60 + minute;
}

/** "HH:MM" or "HH:MM:SS" (what Postgres `time` serialises to) as minutes. */
export function parseClockTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export type QuietHoursWindow = {
  enabled: boolean;
  /** "HH:MM" / "HH:MM:SS", as stored. */
  start: string;
  end: string;
  /** The recipient's IANA zone, or null when they have never told KIVO. */
  timeZone: string | null;
};

/**
 * The instant a notification produced `at` should stop being held back, or
 * null when it should never be held back at all.
 *
 * Null is returned for every case where quiet hours do not apply, and those
 * cases are worth naming because each one is a decision:
 *
 *   disabled           the default. KIVO does not guess when anyone sleeps.
 *   no timezone        `profiles.timezone` is null and KIVO never infers one
 *                      from an IP. A window with no zone to interpret it in is
 *                      not a window, and silently applying UTC would hold a
 *                      Lagos user's notifications back by the wrong hour.
 *   unparseable window a stored value this code cannot read is a bug, and the
 *                      safe failure is to deliver normally rather than to
 *                      silence somebody by accident.
 *   zero-length window start equal to end. Two readings are possible ("never"
 *                      and "always"), so it means neither and the caller is
 *                      not silenced on an ambiguity.
 *   outside the window the ordinary case.
 */
export function quietUntil(window: QuietHoursWindow, at: Date = new Date()): Date | null {
  if (!window.enabled || !window.timeZone) return null;

  const start = parseClockTime(window.start);
  const end = parseClockTime(window.end);
  if (start === null || end === null || start === end) return null;

  let now: number;
  try {
    now = localMinutes(at, window.timeZone);
  } catch {
    // An IANA zone this runtime's ICU data does not know. Same reasoning as
    // above: deliver normally rather than silence somebody on a bad value.
    return null;
  }

  const crossesMidnight = end < start;
  const inside = crossesMidnight ? now >= start || now < end : now >= start && now < end;
  if (!inside) return null;

  // Minutes from now until the window's end, in wall-clock terms.
  const minutesUntilEnd = end > now ? end - now : end + 24 * 60 - now;

  // Added as elapsed real time. Across a DST transition inside the window this
  // can land an hour either side of the intended wall-clock moment — the badge
  // then reappears an hour early or an hour late, twice a year. Correcting it
  // would mean resolving a wall-clock instant back through the zone's offset
  // rules, and the failure it would fix is an hour of badge timing. Written
  // down rather than silently accepted.
  return new Date(at.getTime() + minutesUntilEnd * 60_000);
}

/** Human description of a window, for the Settings screen. Returns null when
 * there is nothing real to describe. */
export function describeQuietHours(window: QuietHoursWindow): string | null {
  if (!window.enabled) return null;
  const start = parseClockTime(window.start);
  const end = parseClockTime(window.end);
  if (start === null || end === null) return null;

  const label = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return `${label(start)} to ${label(end)}`;
}
