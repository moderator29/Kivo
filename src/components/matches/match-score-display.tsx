"use client";

import { useMemo } from "react";
import { STATUS_LABEL, isLiveStatus } from "@/lib/football/fixture-status";
import { useRealtimeFixtures } from "@/hooks/use-realtime-fixtures";
import type { Database } from "@/lib/supabase/types";

type FixtureStatus = Database["public"]["Enums"]["fixture_status"];

/**
 * The score+status block inside Match Centre's header card. Split out as its
 * own Client Component so only this small piece re-renders on a Realtime
 * update (via useRealtimeFixtures) rather than making the whole,
 * heavily-server-rendered match page (venue, managers, standings context,
 * H2H, etc.) a client boundary just for the score. The `kivo-score-reveal`/
 * `kivo-live-breathe`/`kivo-live-ring` keyframes it uses are still defined by
 * the parent server component's inline `<style>` tag — a `<style>` block
 * applies document-wide once rendered, regardless of which component in the
 * tree needs the class, so nothing needed duplicating here.
 */
export function MatchScoreDisplay({
  fixtureId,
  status,
  homeScore,
  awayScore,
  minuteElapsed,
  kickoffAt,
}: {
  fixtureId: string;
  status: FixtureStatus;
  homeScore: number | null;
  awayScore: number | null;
  minuteElapsed: number | null;
  kickoffAt: string;
}) {
  // Memoized so the array identity useRealtimeFixtures receives is stable
  // across renders that don't actually change any of these fields. Without
  // this, a brand-new array literal on every render is indistinguishable
  // (by the hook's own reference-equality check) from genuinely fresh
  // server data, so the hook's Realtime-driven setState would immediately
  // be "reset" back to these props during the very next render — which
  // recreates the array again, forever, tripping React's "Too many
  // re-renders" guard on the first live score update.
  const initialFixtures = useMemo(
    () => [{ id: fixtureId, status, home_score: homeScore, away_score: awayScore, minute_elapsed: minuteElapsed }],
    [fixtureId, status, homeScore, awayScore, minuteElapsed],
  );
  const [fixture] = useRealtimeFixtures(initialFixtures);
  const hasScore = fixture.home_score !== null && fixture.away_score !== null;
  const live = isLiveStatus(fixture.status);

  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      {/* Keyed off the score itself so `kivo-score-reveal` remounts (and
          therefore replays) on every genuine score change, not just once on
          mount — a static class string never re-triggers a CSS animation on
          its own. */}
      <span
        key={`${fixture.home_score}-${fixture.away_score}`}
        className="animate-[kivo-score-reveal_0.5s_ease-out_0.1s_both] text-2xl font-semibold text-foreground"
      >
        {hasScore ? `${fixture.home_score} – ${fixture.away_score}` : "vs"}
      </span>
      <span
        className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
          live
            ? "motion-safe:animate-[kivo-live-breathe_2.2s_ease-in-out_infinite] border-live/30 bg-live/10 text-live"
            : "border-white/10 text-foreground-subtle"
        }`}
      >
        {live && (
          <span className="h-1.5 w-1.5 shrink-0 motion-safe:animate-[kivo-live-ring_2s_ease-out_infinite] rounded-full bg-live" />
        )}
        {fixture.status === "scheduled"
          ? new Date(kickoffAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          : STATUS_LABEL[fixture.status]}
      </span>
    </div>
  );
}
