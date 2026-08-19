/**
 * XP earned in the last 7 and 30 days, and in the equal window before each.
 *
 * Pure, and separate from the page, for one reason: every mistake this could
 * make is a mistake nobody would see. An off-by-one on a boundary, a previous
 * window that overlaps the current one, or a comparison against a period that
 * predates the account all produce a plausible-looking number on a profile —
 * which on this product is the worst kind of bug there is.
 *
 * The rules:
 *
 * - A window is `(now - days, now]`. Half-open at the old end, so a row can
 *   never be counted in both a window and its predecessor.
 * - `previous` is null unless the account is at least *two* full windows old.
 *   An account eight days old has a previous seven days that is one day long,
 *   and comparing a week against a day manufactures a collapse out of a
 *   signup date.
 * - Only positive-sum arithmetic on real rows. Nothing is estimated, and a
 *   window with no rows is a real zero — the user genuinely earned nothing —
 *   not a missing value.
 */

export type XpEntry = { amount: number; createdAt: string };

export type XpWindowSummary = {
  id: "7d" | "30d";
  label: string;
  days: number;
  earned: number;
  previous: number | null;
};

const WINDOWS: { id: XpWindowSummary["id"]; label: string; days: number }[] = [
  { id: "7d", label: "7d", days: 7 },
  { id: "30d", label: "30d", days: 30 },
];

const DAY_MS = 86_400_000;

export function summariseXpWindows(
  entries: XpEntry[],
  /** `profiles.created_at`. */
  joinedAt: string,
  now: number = Date.now(),
): XpWindowSummary[] {
  const joined = Date.parse(joinedAt);

  return WINDOWS.map(({ id, label, days }) => {
    const windowMs = days * DAY_MS;
    const start = now - windowMs;
    const previousStart = start - windowMs;

    let earned = 0;
    let previous = 0;
    for (const entry of entries) {
      const at = Date.parse(entry.createdAt);
      if (Number.isNaN(at)) continue;
      if (at > start && at <= now) earned += entry.amount;
      else if (at > previousStart && at <= start) previous += entry.amount;
    }

    const hasFullPreviousWindow = !Number.isNaN(joined) && joined <= previousStart;
    return { id, label, days, earned, previous: hasFullPreviousWindow ? previous : null };
  });
}

/** How far back the caller has to read `xp_ledger` for the summary above to be
 * complete: the longest window, doubled, so its predecessor is covered too. */
export const XP_WINDOW_LOOKBACK_DAYS = 60;

/**
 * The `created_at` floor for that read, as an ISO string.
 *
 * Lives here rather than inline in the page for the same reason `todayIn`
 * lives in `date-strip`: reading the clock is impure, and this codebase keeps
 * impure reads in modules rather than in component bodies, where a re-render
 * would silently move the boundary.
 */
export function xpWindowFloorIso(now: number = Date.now()): string {
  return new Date(now - XP_WINDOW_LOOKBACK_DAYS * 86_400_000).toISOString();
}
