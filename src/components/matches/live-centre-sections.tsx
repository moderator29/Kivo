"use client";

import { useState } from "react";
import { Radio } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { FixtureGroups, type LiveListFixture } from "@/components/matches/live-fixture-list";
import { CompetitionFilter, type CompetitionFilterOption } from "@/components/matches/competition-filter";
import { isLiveStatus } from "@/lib/football/fixture-status";
import { useRealtimeFixtures } from "@/hooks/use-realtime-fixtures";

/** The competitions actually represented in the list, in the order they first
 * appear — same first-appearance ordering `groupFixturesByCompetition` uses,
 * so the sheet's rows and the page's sections read in the same order. */
function competitionOptions(fixtures: LiveListFixture[]): CompetitionFilterOption[] {
  const byId = new Map<string, CompetitionFilterOption>();
  for (const fixture of fixtures) {
    const competition = fixture.competition;
    if (!competition?.id) continue;
    const existing = byId.get(competition.id);
    if (existing) {
      existing.count += 1;
      continue;
    }
    byId.set(competition.id, {
      id: competition.id,
      name: competition.name,
      shortName: competition.short_name,
      logoUrl: competition.logo_url ?? null,
      count: 1,
    });
  }
  return [...byId.values()];
}

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

  /**
   * The competition filter is client state here, not a query param the way
   * `/matches` does it, and the difference is not an inconsistency — it is
   * what the two pages are. `/matches` is a server-rendered view of one
   * calendar day, so its filter is part of the address. This list is owned by
   * a live subscription: a navigation would tear down the channel and rebuild
   * it to show a subset of rows this component already holds. Filtering in
   * place keeps every row live while it is hidden, so unfiltering shows the
   * current score rather than the one from when the filter went on.
   */
  const [competitionId, setCompetitionId] = useState<string | null>(null);
  const options = competitionOptions(all);
  // A competition that had a fixture when the filter was set can genuinely
  // leave the list (a late kickoff finishing, a realtime status change taking
  // the last row out of the window). Falling back to the whole list beats
  // holding an empty one behind a filter the user can no longer see the reason
  // for.
  const activeId = options.some((option) => option.id === competitionId) ? competitionId : null;
  const visible = activeId ? all.filter((fixture) => fixture.competition?.id === activeId) : all;
  const live = visible.filter((f) => isLiveStatus(f.status));
  const notLive = visible.filter((f) => !isLiveStatus(f.status));

  return (
    <>
      <FadeIn className="flex items-start justify-between gap-3">
        <p className="text-sm text-foreground-muted">
          {live.length > 0
            ? `Matches in progress right now${providerLabel ? `, synced from ${providerLabel}` : ""}.`
            : "Nothing in play right now. Here's what's on today."}
        </p>
        <CompetitionFilter
          options={options}
          selectedId={activeId}
          totalCount={all.length}
          onSelect={setCompetitionId}
          className="shrink-0"
        />
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
