/**
 * Transfer windows, and the honest state of them.
 *
 * The directive asks the Transfer Centre for a window countdown. Two things
 * are true about that, and both are in this file:
 *
 * **1. The countdown mechanism is real and complete.** `nextTransferWindow`
 * resolves the next close from a registry of dated windows and
 * `formatDurationUntil` renders it, the same clock the fantasy deadline and
 * /home's next-kickoff slot use. Add a verified window and it counts down.
 *
 * **2. The registry is empty, on purpose.** Registration periods are set per
 * national association, change every year, and appear nowhere in the provider
 * feed KIVO syncs — API-Football has no window endpoint on any plan. Typing in
 * a set of dates from memory would put a countdown to a fabricated deadline on
 * a page whose entire premise is that it does not fabricate. So the UI says
 * exactly that, and shows the real thing instead: what KIVO has actually
 * recorded lately.
 *
 * Filling this in is a data-entry task with a source requirement, not a code
 * task: each entry needs the association's published dates and a link to them,
 * which is why `sourceUrl` is required rather than optional. See
 * RECOMMENDATIONS.md's transfer-centre entry.
 */

export type TransferWindow = {
  /** Which association or competition this window governs, in words. */
  scope: string;
  /** ISO dates. Inclusive open, inclusive close — the window's own convention. */
  opensOn: string;
  closesAt: string;
  /** Where the dates came from. Required: a window with no citation is
   * indistinguishable from a guess, and this file exists to keep those apart. */
  sourceUrl: string;
};

/** Deliberately empty. See this module's own doc comment — an entry here is a
 * cited fact, not a recollection. */
export const TRANSFER_WINDOWS: TransferWindow[] = [];

/**
 * The next window to close, at the given instant, or null when none is
 * configured or all configured ones have closed. Pure and clock-injected so a
 * test never depends on the day it runs.
 */
export function nextTransferWindow(now: Date | number = Date.now()): TransferWindow | null {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const upcoming = TRANSFER_WINDOWS.filter((window) => new Date(window.closesAt).getTime() > nowMs).sort(
    (a, b) => new Date(a.closesAt).getTime() - new Date(b.closesAt).getTime(),
  );
  return upcoming[0] ?? null;
}

/** What KIVO has genuinely recorded recently. Every number is a count of real
 * `transfers` rows — this is what stands in for a countdown until a cited
 * window exists, and it is labelled as recorded activity, never as a window. */
export type RecordedTransferActivity = {
  last7Days: number;
  last30Days: number;
  /** The newest recorded move's date, or null when nothing is synced. */
  mostRecentDate: string | null;
  /** How many distinct clubs appear on either end of the last 30 days of
   * moves — a real measure of how broad the recent activity is. */
  clubsInvolvedLast30Days: number;
};

export function summariseRecordedActivity(
  rows: { transfer_date: string; from_team_id: string | null; to_team_id: string | null }[],
  now: Date | number = Date.now(),
): RecordedTransferActivity {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const day = 86_400_000;

  let last7Days = 0;
  let last30Days = 0;
  let mostRecentDate: string | null = null;
  const clubs = new Set<string>();

  for (const row of rows) {
    const ageMs = nowMs - new Date(row.transfer_date).getTime();
    // A transfer_date in the future is real data (a move recorded ahead of the
    // date it takes effect) and is not "recent activity" — counting it as
    // something that just happened would be wrong.
    if (ageMs < 0) continue;
    if (ageMs <= 7 * day) last7Days += 1;
    if (ageMs <= 30 * day) {
      last30Days += 1;
      if (row.from_team_id) clubs.add(row.from_team_id);
      if (row.to_team_id) clubs.add(row.to_team_id);
    }
    if (!mostRecentDate || row.transfer_date > mostRecentDate) mostRecentDate = row.transfer_date;
  }

  return { last7Days, last30Days, mostRecentDate, clubsInvolvedLast30Days: clubs.size };
}
