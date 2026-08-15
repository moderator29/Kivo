import { isLiveStatus, statusBadgeText, type FixtureStatus } from "@/lib/football/fixture-status";

/**
 * The small rounded status pill used on fixture rows (Matches, Live, a
 * team's upcoming/recent fixtures) — kickoff time when scheduled, otherwise
 * FT/HT/Live/etc, with an optional pulsing dot while the match is live.
 *
 * Not used by the match-centre hero badge (`matches/[id]/page.tsx`), which
 * has its own bespoke breathing/ring animation treatment appropriate for
 * that page's larger "live match" hero moment — genuinely different
 * markup, not just a smaller copy of this one.
 */
export function FixtureStatusBadge({
  status,
  kickoffAt,
  includeWeekday = false,
  showLiveDot = true,
  minuteElapsed = null,
}: {
  status: FixtureStatus;
  kickoffAt: string;
  includeWeekday?: boolean;
  showLiveDot?: boolean;
  /** fixtures.minute_elapsed (RECOMMENDATIONS.md item 57) — when the fixture
   * is live and this is set, shows "67'" instead of the generic "Live" label.
   * Omit (or pass null) anywhere the caller hasn't selected the column yet;
   * every other status ignores this and keeps its own fixed label. */
  minuteElapsed?: number | null;
}) {
  const live = isLiveStatus(status);
  return (
    <span
      className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        live
          ? "border-live/30 bg-live/10 text-live"
          : status === "finished"
            ? "border-white/10 text-foreground-subtle"
            : "border-white/10 text-foreground-muted"
      }`}
    >
      {live && showLiveDot && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-live opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-live" />
        </span>
      )}
      {statusBadgeText(status, kickoffAt, { includeWeekday, minuteElapsed })}
    </span>
  );
}
