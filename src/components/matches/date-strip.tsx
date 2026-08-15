import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** UTC `YYYY-MM-DD` key — matches the `?date=` search param format and the
 * UTC day-boundary convention already used for fixture queries throughout
 * the app (Home/Live/Matches all floor `kickoff_at` ranges to UTC midnight). */
export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function todayUtc(): Date {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today;
}

const WINDOW_RADIUS = 3; // 7-day window centered on the selected date

/**
 * Horizontal date strip for `/matches` — a 7-day window centered on the
 * selected date, plus prev/next day arrows and a "Today" shortcut. Pure
 * `<Link>`s driven by the `?date=YYYY-MM-DD` search param so the page stays
 * a plain Server Component; no client-side state needed.
 */
export function MatchesDateStrip({ selected }: { selected: Date }) {
  const selectedKey = dateKey(selected);
  const todayKey = dateKey(todayUtc());
  const days = Array.from({ length: WINDOW_RADIUS * 2 + 1 }, (_, i) => addDays(selected, i - WINDOW_RADIUS));

  return (
    <div className="flex items-center gap-1.5">
      <Link
        href={`/matches?date=${dateKey(addDays(selected, -1))}`}
        aria-label="Previous day"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 text-foreground-muted transition hover:bg-white/[0.06] hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
      </Link>

      <div className="flex flex-1 items-center gap-1.5 overflow-x-auto">
        {days.map((day) => {
          const key = dateKey(day);
          const isSelected = key === selectedKey;
          const isToday = key === todayKey;
          return (
            <Link
              key={key}
              href={`/matches?date=${key}`}
              aria-current={isSelected ? "date" : undefined}
              className={`flex shrink-0 flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-center transition ${
                isSelected
                  ? "kivo-gradient-victory text-kivo-white"
                  : "text-foreground-muted hover:bg-white/[0.06] hover:text-foreground"
              }`}
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
                {day.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })}
              </span>
              <span className="text-sm font-semibold tabular-nums">{day.getUTCDate()}</span>
              <span
                className={`h-1 w-1 rounded-full ${isToday ? (isSelected ? "bg-kivo-white" : "bg-kivo-cyan") : "bg-transparent"}`}
                aria-hidden="true"
              />
            </Link>
          );
        })}
      </div>

      <Link
        href={`/matches?date=${dateKey(addDays(selected, 1))}`}
        aria-label="Next day"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 text-foreground-muted transition hover:bg-white/[0.06] hover:text-foreground"
      >
        <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
      </Link>

      {selectedKey !== todayKey && (
        <Link
          href="/matches"
          className="shrink-0 rounded-xl border border-white/10 px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:bg-white/[0.06] hover:text-foreground"
        >
          Today
        </Link>
      )}
    </div>
  );
}
