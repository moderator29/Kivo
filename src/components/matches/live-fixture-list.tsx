"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Shirt } from "lucide-react";
import { TeamCrest } from "@/components/ui/team-crest";
import { FixtureStatusBadge } from "@/components/matches/fixture-status-badge";
import { isLiveStatus } from "@/lib/football/fixture-status";
import { groupFixturesByCompetition } from "@/lib/football/group-by-competition";
import {
  rankCompetitionGroups,
  NO_COMPETITION_RANKING_SIGNALS,
  type CompetitionRankingSignals,
} from "@/lib/football/competition-tier";
import { CompetitionGroupHeader } from "@/components/matches/competition-group-header";
import type { Database } from "@/lib/supabase/types";

const EASE = [0.22, 1, 0.36, 1] as const;

type FixtureStatus = Database["public"]["Enums"]["fixture_status"];

export type LiveListFixture = {
  id: string;
  kickoff_at: string;
  status: FixtureStatus;
  home_score: number | null;
  away_score: number | null;
  minute_elapsed: number | null;
  home_team: { name: string; crest_url: string | null } | null;
  away_team: { name: string; crest_url: string | null } | null;
  competition: {
    id: string | null;
    name: string;
    short_name: string | null;
    logo_url?: string | null;
    /** `competitions.country`. Null on every row the live provider has synced
     * so far — the header omits the line entirely rather than filling it in.
     * See CompetitionGroupHeader. */
    country?: string | null;
  } | null;
};

/**
 * Presentational list of fixtures grouped by competition.
 *
 * Deliberately does **not** subscribe to Realtime itself. It used to (as
 * `LiveFixtureList`), which was fine while /live rendered exactly one of these
 * — but the page now renders a "Live now" and a "Today" section off one shared
 * live-updating list (KIVO_NEXT_GEN KN-5), and two independently-subscribed
 * lists could not have moved a fixture from one section to the other. The
 * subscription now lives one level up, in LiveCentreSections.
 */
export function FixtureGroups({
  fixtures,
  showLiveDot = true,
  fantasyMatchCounts,
  rankingSignals = NO_COMPETITION_RANKING_SIGNALS,
  signedIn = false,
}: {
  fixtures: LiveListFixture[];
  /** Whether a row that's actually live also gets the pulsing status dot
   * (in addition to its live-coloured score text). Defaults on. Pass false
   * from a "Live now" section that already carries its own live indicator
   * (e.g. a header Radio icon) — the dot would be redundant there. */
  showLiveDot?: boolean;
  /** RECOMMENDATIONS.md item 297: fixture id -> real count of the viewer's
   * own fantasy players named in that fixture's lineups (see live/page.tsx's
   * own doc comment for the full join). Omitted entirely for a guest — a
   * row with no entry (or a count of 0, filtered out by the caller) renders
   * exactly as it does today. */
  fantasyMatchCounts?: Record<string, number>;
  /** The four signals that decide which competition leads the list — the
   * viewer's own favourites, KIVO's configured coverage scope, real follower
   * counts, then the kickoff order it already had. Read on the server (see
   * src/lib/football/competition-ranking.ts) and passed down, because none of
   * them is derivable from the fixtures themselves. Defaults to none, which
   * leaves the kickoff order exactly as it was. */
  rankingSignals?: CompetitionRankingSignals;
  /** Whether the viewer is signed in — the favourite star routes a guest to
   * sign-up instead of firing a server action that would be refused. */
  signedIn?: boolean;
}) {
  const groups = rankCompetitionGroups(groupFixturesByCompetition(fixtures), rankingSignals);

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.competitionId ?? group.competitionName ?? "unnamed"} className="flex flex-col gap-1">
          <CompetitionGroupHeader
            competitionId={group.competitionId}
            competitionName={group.competitionName}
            country={group.fixtures[0]?.competition?.country ?? null}
            logoUrl={group.fixtures[0]?.competition?.logo_url ?? null}
            fixtureCount={group.fixtures.length}
            isFavourite={group.isFavourite}
            signedIn={signedIn}
            density="compact"
          />
          <div className="flex flex-col divide-y divide-hairline-soft">
            {group.fixtures.map((fixture) => (
              <FixtureRowCard
                key={fixture.id}
                fixture={fixture}
                showLiveDot={showLiveDot}
                fantasyPlayerCount={fantasyMatchCounts?.[fixture.id] ?? 0}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FixtureRowCard({
  fixture,
  showLiveDot,
  fantasyPlayerCount,
}: {
  fixture: LiveListFixture;
  showLiveDot: boolean;
  fantasyPlayerCount: number;
}) {
  const hasScore = fixture.home_score !== null && fixture.away_score !== null;
  const live = isLiveStatus(fixture.status);

  // Brief highlight when this row's live-relevant fields change via
  // Realtime, so a score/minute update has some on-screen cue beyond the
  // text silently swapping — especially noticeable with several live rows
  // listed together. Deliberately skipped on the initial mount (only fires
  // once the composite key actually *changes* from a previous render), so
  // the whole list doesn't flash on first paint.
  const updateKey = `${fixture.status}-${fixture.home_score}-${fixture.away_score}-${fixture.minute_elapsed}`;
  const prevUpdateKeyRef = useRef(updateKey);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (prevUpdateKeyRef.current === updateKey) return;
    prevUpdateKeyRef.current = updateKey;
    setFlash(true);
    const timeout = setTimeout(() => setFlash(false), 1200);
    return () => clearTimeout(timeout);
  }, [updateKey]);

  return (
    // `layout` (RECOMMENDATIONS.md item 269) so a fixture that moves within
    // its group — e.g. `groupFixturesByCompetition`'s output reordering as
    // scores/statuses change — animates (a FLIP transform) instead of
    // silently jumping to its new position. The plain wrapping `motion.div`
    // exists only so `layout` has a real element to measure/animate;
    // `<Link>` keeps every visual class and stays the actual click target.
    <motion.div layout transition={{ duration: 0.35, ease: EASE }}>
      <Link
        href={`/matches/${fixture.id}`}
        className={`flex flex-col gap-2 rounded-xl px-2 py-2 transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${flash ? "kivo-row-flash" : ""}`}
      >
        <div className="flex items-center justify-end">
          <FixtureStatusBadge
            status={fixture.status}
            kickoffAt={fixture.kickoff_at}
            showLiveDot={showLiveDot}
            minuteElapsed={fixture.minute_elapsed}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <TeamCrest crestUrl={fixture.home_team?.crest_url ?? null} name={fixture.home_team?.name ?? "Home"} />
            <span className="line-clamp-2 break-words text-sm text-foreground">{fixture.home_team?.name ?? "Home team"}</span>
          </div>
          <span className={`shrink-0 text-sm font-semibold ${live ? "text-live" : "text-foreground"}`}>
            {hasScore ? `${fixture.home_score} – ${fixture.away_score}` : "vs"}
          </span>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <span className="line-clamp-2 break-words text-right text-sm text-foreground">{fixture.away_team?.name ?? "Away team"}</span>
            <TeamCrest crestUrl={fixture.away_team?.crest_url ?? null} name={fixture.away_team?.name ?? "Away"} />
          </div>
        </div>
        {/* RECOMMENDATIONS.md item 297: a real, signed-in-only personalization
            signal — omitted entirely rather than shown as "0 of your fantasy
            players", same "render nothing below a real floor" convention as
            HeadToHeadCard/MatchVerdictCard elsewhere in the app. */}
        {fantasyPlayerCount > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-accent">
            <Shirt className="h-3 w-3 shrink-0" strokeWidth={2} />
            {fantasyPlayerCount} of your fantasy player{fantasyPlayerCount === 1 ? "" : "s"} {fantasyPlayerCount === 1 ? "is" : "are"} in this match
          </div>
        )}
      </Link>
    </motion.div>
  );
}
