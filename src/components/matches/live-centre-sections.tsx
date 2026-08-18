"use client";

import { Radio } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { FixtureGroups, type LiveListFixture } from "@/components/matches/live-fixture-list";
import { isLiveStatus } from "@/lib/football/fixture-status";
import { useRealtimeFixtures } from "@/hooks/use-realtime-fixtures";

/**
 * The whole body of /live below the heading, as one client component.
 *
 * KIVO_NEXT_GEN KN-5: the page used to decide its own section layout on the
 * server — it computed `hasLiveFixtures` at render time and showed *either* a
 * "Live now" block *or* a "Today's fixtures" block, then let
 * `useRealtimeFixtures` push status changes into whichever list had been
 * rendered. The realtime plumbing worked; the structure around it was a
 * server-time snapshot. A fixture that kicked off while someone sat on the page
 * flipped its badge to LIVE inside the "Today's fixtures" card and never moved
 * up; a finished match stayed under "Live now" until a reload. Which is the
 * exact opposite of what a live page is for.
 *
 * So the server now hands down one list and this partitions it from current
 * status on every render. A kickoff genuinely moves the row between sections,
 * and the subscription lives here — one channel for the whole page — rather
 * than one per rendered list, which is also what makes a cross-section move
 * possible at all.
 *
 * The two sections are shown together rather than either/or. Hiding today's
 * remaining fixtures the moment one match kicks off was never deliberate — it
 * fell out of the either/or structure — and "what's on later today" is exactly
 * what someone watching a live match wants next.
 */
export function LiveCentreSections({
  fixtures,
  fantasyMatchCounts,
  providerLabel,
}: {
  fixtures: LiveListFixture[];
  fantasyMatchCounts: Record<string, number>;
  /**
   * The football provider actually in use, from `getActiveProviderStatus()`,
   * or null when none is configured. KIVO_NEXT_GEN KN-8: this copy used to say
   * "synced from API-Football" unconditionally, while `FOOTBALL_DATA_PROVIDER`
   * selects between two real implementations — a hardcoded vendor name in
   * user-facing copy is the same class of error as a fabricated stat.
   */
  providerLabel: string | null;
}) {
  const all = useRealtimeFixtures(fixtures);
  const live = all.filter((f) => isLiveStatus(f.status));
  const notLive = all.filter((f) => !isLiveStatus(f.status));

  return (
    <>
      <FadeIn className="flex items-start justify-between gap-3">
        <p className="text-sm text-foreground-muted">
          {live.length > 0
            ? `Matches in progress right now${providerLabel ? `, synced from ${providerLabel}` : ""}.`
            : "Nothing in play right now. Here's what's on today."}
        </p>
      </FadeIn>

      {live.length > 0 && (
        <FadeIn delay={0.05} className="kivo-glass-brand rounded-2xl p-5">
          <div className="mb-3 flex items-center gap-2">
            <Radio className="h-4 w-4 text-live" strokeWidth={1.75} />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Live now</h2>
          </div>
          {/* No live dot here — redundant with this section's own Radio-icon
              header, unlike "Today's fixtures" below where a fixture could
              flip to live mid-session via Realtime with no other cue on the
              page. */}
          <FixtureGroups fixtures={live} showLiveDot={false} fantasyMatchCounts={fantasyMatchCounts} />
        </FadeIn>
      )}

      {notLive.length > 0 && (
        <FadeIn delay={0.05} className="kivo-glass rounded-2xl p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
            Today&apos;s fixtures
          </h2>
          <FixtureGroups fixtures={notLive} fantasyMatchCounts={fantasyMatchCounts} />
        </FadeIn>
      )}
    </>
  );
}
