/**
 * Pure helpers backing the /rewards daily-activity streak section. The
 * actual streak numbers (current/longest) come from the real
 * get_activity_streak() RPC (supabase/migrations/0037_activity_streak.sql,
 * derived from xp_ledger — see that file for the full "qualifying day"
 * reasoning). Everything here is presentation logic only: tiering the
 * current streak, and laying out the Mon-Sun week strip from a set of real
 * active dates the caller already fetched.
 */

/**
 * Tier thresholds for the streak. One documented constant instead of magic
 * numbers scattered across the UI: every STREAK_TIER_LENGTH_DAYS of
 * *current* streak unlocks the next tier — mirrors the reference layout's
 * "N more days to unlock next tier" copy and lines up with the week strip's
 * 7-day span, so "a full week" is the same idea in both places.
 */
export const STREAK_TIER_LENGTH_DAYS = 7;

/**
 * Tier display names, in order. Beyond the last name the tier keeps
 * incrementing numerically ("Elite II", "Elite III", ...) rather than
 * inventing more names, so a genuinely long real streak is never capped by
 * how many names are in this list.
 */
export const STREAK_TIER_NAMES = ["Rookie", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Elite"] as const;

export type StreakTierInfo = {
  /** 1-indexed tier number (tier 1 = streak days 0-6). */
  tierNumber: number;
  tierName: string;
  /** Days of the current streak already counted toward this tier (0-6). */
  daysIntoTier: number;
  /** Days still needed, at the current pace, to unlock the next tier. */
  daysToNextTier: number;
  /** 0-1 progress through the current tier, for a progress bar. */
  progress: number;
};

export function getStreakTier(currentStreak: number): StreakTierInfo {
  const safeStreak = Math.max(0, currentStreak);
  const tierIndex = Math.floor(safeStreak / STREAK_TIER_LENGTH_DAYS);
  const daysIntoTier = safeStreak % STREAK_TIER_LENGTH_DAYS;
  const namedIndex = Math.min(tierIndex, STREAK_TIER_NAMES.length - 1);
  const overflow = tierIndex - namedIndex;
  const tierName = overflow > 0 ? `${STREAK_TIER_NAMES[namedIndex]} ${overflow + 1}` : STREAK_TIER_NAMES[namedIndex];

  return {
    tierNumber: tierIndex + 1,
    tierName,
    daysIntoTier,
    daysToNextTier: STREAK_TIER_LENGTH_DAYS - daysIntoTier,
    progress: daysIntoTier / STREAK_TIER_LENGTH_DAYS,
  };
}

export type WeekStripDay = {
  /** UTC calendar date, "YYYY-MM-DD". */
  isoDate: string;
  /** Two-letter weekday label, "Mo".."Su" — unambiguous unlike single
   * letters, which repeat ("T" for Tue/Thu, "S" for Sat/Sun). */
  label: string;
  /** Day-of-month number for display. */
  dayNumber: number;
  isToday: boolean;
  /** After today — never marked active even if somehow present in the set. */
  isFuture: boolean;
  /** A real xp_ledger row exists for this date. Always false for future days. */
  isActive: boolean;
};

const WEEKDAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Monday (UTC midnight) of the week containing `dateUtc`. Shared by
 * buildWeekStrip and the page's own xp_ledger range query so both agree on
 * exactly where "this week" starts. */
export function mondayOfWeekUtc(dateUtc: Date): Date {
  // ISO weekday: 1 = Monday .. 7 = Sunday. Step back to this week's Monday.
  const isoWeekday = ((dateUtc.getUTCDay() + 6) % 7) + 1;
  const monday = new Date(dateUtc);
  monday.setUTCDate(dateUtc.getUTCDate() - (isoWeekday - 1));
  return monday;
}

/**
 * Builds the Mon-Sun strip for the UTC week containing `todayUtc`, marking
 * each day active only if its ISO date is in `activeDatesUtc` — the set of
 * real dates the caller derived from the profile's own xp_ledger rows.
 * Future days (after today) are always isFuture and never isActive, so the
 * UI can never render a fabricated checkmark for a day that hasn't happened.
 * UTC is used throughout to match get_activity_streak()'s day boundary, so
 * "today" here is never off-by-one from what the streak count says.
 */
export function buildWeekStrip(todayUtc: Date, activeDatesUtc: Set<string>): WeekStripDay[] {
  const todayIso = toIsoDate(todayUtc);
  const monday = mondayOfWeekUtc(todayUtc);

  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday);
    day.setUTCDate(monday.getUTCDate() + i);
    const isoDate = toIsoDate(day);
    const isFuture = isoDate > todayIso;
    return {
      isoDate,
      label: WEEKDAY_LABELS[i],
      dayNumber: day.getUTCDate(),
      isToday: isoDate === todayIso,
      isFuture,
      isActive: !isFuture && activeDatesUtc.has(isoDate),
    };
  });
}
