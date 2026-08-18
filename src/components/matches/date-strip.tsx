import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DISPLAY_LOCALE } from "@/lib/format";
import { dayKeyInTimeZone, startOfDayInTimeZone } from "@/lib/timezone";

/**
 * KN-32. Every one of these used to be a UTC day, and the whole app agreed with
 * itself about that — which is exactly what made it hard to see. For the stated
 * launch market (Nigeria, UTC+1) a 00:30 kickoff belongs to the previous UTC
 * day, so it disappeared from "today" for the people closest to it; further
 * from UTC the mismatch is hours wide. `kickoff_at` is a `timestamptz` naming a
 * real instant, so querying a *local* day's range against it is exact — the UTC
 * convention was never required by the data, only by the code.
 *
 * `timeZone` is threaded in from the caller (which resolves it from
 * `profiles.timezone`, migration 0054) rather than read here, so this component
 * stays pure and server-renderable and there is exactly one place that decides
 * whose day it is.
 */
export function dateKey(date: Date, timeZone: string): string {
  return dayKeyInTimeZone(timeZone, date);
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Steps a whole calendar day in `timeZone`, not 86,400,000 milliseconds.
 * Stepping by a fixed duration is wrong twice a year: across a DST transition
 * the day is 23 or 25 hours long, so a fixed step lands either just short of
 * the boundary (repeating a day) or past it (skipping one).
 *
 * Three moves, and each is load-bearing:
 *
 *  1. Floor the input to local midnight FIRST. Without this the function has an
 *     unstated precondition — "you must already have passed me a local
 *     midnight" — and any caller handing it an arbitrary instant gets an answer
 *     that is right for some inputs and a day out for others.
 *  2. Step `days * 24h`, which lands within an hour of the target midnight in
 *     any zone on earth.
 *  3. Add a further **+12h, always**, then re-floor. The nudge parks the
 *     candidate in the middle of the target day so the DST slop in step 2
 *     cannot push it over either boundary. It must not be signed with `days`:
 *     nudging backwards for a negative step subtracts 36 hours in total and
 *     lands on the day before the one asked for.
 */
export function addDays(date: Date, days: number, timeZone: string): Date {
  const start = startOfDayInTimeZone(timeZone, date);
  return startOfDayInTimeZone(timeZone, new Date(start.getTime() + days * 24 * HOUR_MS + 12 * HOUR_MS));
}

/** Start of the viewer's own today, as a real instant. */
export function todayIn(timeZone: string): Date {
  return startOfDayInTimeZone(timeZone);
}

const WINDOW_RADIUS = 3; // 7-day window centered on the selected date

/**
 * Horizontal date strip for `/matches` — a 7-day window centered on the
 * selected date, plus prev/next day arrows and a "Today" shortcut. Pure
 * `<Link>`s driven by the `?date=YYYY-MM-DD` search param so the page stays
 * a plain Server Component; no client-side state needed.
 */
export function MatchesDateStrip({ selected, timeZone }: { selected: Date; timeZone: string }) {
  const selectedKey = dateKey(selected, timeZone);
  const todayKey = dateKey(todayIn(timeZone), timeZone);
  const days = Array.from({ length: WINDOW_RADIUS * 2 + 1 }, (_, i) => addDays(selected, i - WINDOW_RADIUS, timeZone));

  return (
    <div className="flex items-center gap-1.5">
      <Link
        href={`/matches?date=${dateKey(addDays(selected, -1, timeZone), timeZone)}`}
        aria-label="Previous day"
        className="kivo-glass-sharp flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-foreground-muted transition hover:text-foreground kivo-focusable"
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
      </Link>

      <div className="flex flex-1 items-center gap-1.5 overflow-x-auto">
        {days.map((day) => {
          const key = dateKey(day, timeZone);
          const isSelected = key === selectedKey;
          const isToday = key === todayKey;
          return (
            <Link
              key={key}
              href={`/matches?date=${key}`}
              aria-current={isSelected ? "date" : undefined}
              className={`flex shrink-0 flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-center transition ${
                isSelected
                  ? "kivo-gradient-victory text-on-accent"
                  : "text-foreground-muted hover:bg-surface-2 hover:text-foreground"
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60`}
            >
              {/* KN-32: rendered in the viewer's zone, like the key above it.
                  `day` is the instant local midnight begins, so formatting it
                  as UTC would print the previous calendar date for anyone east
                  of Greenwich — the weekday and the number would then disagree
                  with the `?date=` key on the same tile. */}
              <span className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
                {day.toLocaleDateString(DISPLAY_LOCALE, { weekday: "short", timeZone })}
              </span>
              <span className="text-sm font-semibold tabular-nums">{Number(key.slice(8, 10))}</span>
              <span
                className={`h-1 w-1 rounded-full ${isToday ? (isSelected ? "bg-on-accent" : "bg-accent") : "bg-transparent"}`}
                aria-hidden="true"
              />
            </Link>
          );
        })}
      </div>

      <Link
        href={`/matches?date=${dateKey(addDays(selected, 1, timeZone), timeZone)}`}
        aria-label="Next day"
        className="kivo-glass-sharp flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-foreground-muted transition hover:text-foreground kivo-focusable"
      >
        <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
      </Link>

      {selectedKey !== todayKey && (
        <Link
          href="/matches"
          className="kivo-glass-sharp shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:text-foreground kivo-focusable"
        >
          Today
        </Link>
      )}
    </div>
  );
}
