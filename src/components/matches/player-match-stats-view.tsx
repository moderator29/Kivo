"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { staggerDelay } from "@/lib/stagger";
import {
  comparePlayerLines,
  headlinePlayerMetrics,
  orderPlayerLines,
  type PlayerMatchLine,
} from "@/lib/football/player-match-stats";

/**
 * Every player's own line in this match, and any two of them held against each
 * other.
 *
 * ## Why this exists
 *
 * KIVO already holds per-player match numbers for the fixtures it has fetched
 * them for, and until now literally nothing rendered them — the whole table
 * was read by the touch-map engine and by nothing a fan could open. Minutes,
 * shots, key passes, duels, tackles, saves: the substance of an individual
 * performance, bought and stored and invisible.
 *
 * ## Why the comparison is the top of the tab rather than a separate screen
 *
 * "Who won the midfield" is the question these numbers are actually for, and
 * it is a question about two players at once. So the comparison leads, seeded
 * with the player who played the most minutes on each side, and the two lists
 * underneath are how you change either half of it — tapping a name swaps it
 * into the comparison rather than navigating away from the match.
 *
 * ## What is never drawn
 *
 * A bar is only split when BOTH players have a real reported value. One
 * reported value and one absence is not a hundred-nil split, it is one number
 * and a blank — see `comparePlayerLines`, which is where that rule lives and
 * is tested. And there are no positions on a pitch anywhere in this tab: these
 * are counts, the data has no coordinates in it, so nothing here is drawn as
 * though it did.
 */
export function PlayerMatchStatsView({
  homeTeamName,
  awayTeamName,
  homeLines,
  awayLines,
}: {
  homeTeamName: string;
  awayTeamName: string;
  homeLines: PlayerMatchLine[];
  awayLines: PlayerMatchLine[];
}) {
  const home = useMemo(() => orderPlayerLines(homeLines), [homeLines]);
  const away = useMemo(() => orderPlayerLines(awayLines), [awayLines]);

  const [homePick, setHomePick] = useState<string | null>(home[0]?.playerId ?? null);
  const [awayPick, setAwayPick] = useState<string | null>(away[0]?.playerId ?? null);

  const homePlayer = home.find((entry) => entry.playerId === homePick) ?? home[0] ?? null;
  const awayPlayer = away.find((entry) => entry.playerId === awayPick) ?? away[0] ?? null;

  const rows = useMemo(() => comparePlayerLines(homePlayer, awayPlayer), [homePlayer, awayPlayer]);
  const canCompare = homePlayer !== null && awayPlayer !== null;

  return (
    <div className="flex flex-col gap-3">
      {canCompare && rows.length > 0 && (
        <section className="kivo-glass flex flex-col gap-4 rounded-2xl p-4">
          <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
            <ComparedPlayerHeading player={homePlayer} teamName={homeTeamName} />
            <span className="pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-subtle">v</span>
            <ComparedPlayerHeading player={awayPlayer} teamName={awayTeamName} align="right" />
          </div>

          <div className="flex flex-col gap-3">
            {rows.map((row) => {
              const leftWeight = row.left.reported ? row.left.weight : 0;
              const rightWeight = row.right.reported ? row.right.weight : 0;
              const total = leftWeight + rightWeight;
              const leftPct = row.comparable && total > 0 ? (leftWeight / total) * 100 : 50;

              return (
                <div key={row.label} className="flex flex-col gap-1.5">
                  <span className="sr-only">
                    {row.label}: {homePlayer.playerName}{" "}
                    {row.left.reported ? row.left.text : "not reported"}, {awayPlayer.playerName}{" "}
                    {row.right.reported ? row.right.text : "not reported"}
                    {row.comparable ? "" : ". Reported for one player only, so there is nothing to compare."}
                  </span>

                  <div aria-hidden className="flex items-center justify-between gap-2 text-xs">
                    <span className="w-14 font-semibold tabular-nums text-foreground">
                      {row.left.reported ? row.left.text : "–"}
                    </span>
                    <span className="min-w-0 truncate text-center text-foreground-subtle">{row.label}</span>
                    <span className="w-14 text-right font-semibold tabular-nums text-foreground">
                      {row.right.reported ? row.right.text : "–"}
                    </span>
                  </div>

                  {row.comparable && total > 0 ? (
                    <div aria-hidden className="flex h-1.5 overflow-hidden rounded-full bg-surface-inset">
                      <div className="kivo-gradient-prime h-full" style={{ width: `${leftPct}%` }} />
                      <div className="h-full bg-surface-track" style={{ width: `${100 - leftPct}%` }} />
                    </div>
                  ) : (
                    <div aria-hidden className="h-1.5 rounded-full bg-surface-inset" />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PlayerColumn
          teamName={homeTeamName}
          lines={home}
          selectedId={homePlayer?.playerId ?? null}
          onSelect={setHomePick}
        />
        <PlayerColumn
          teamName={awayTeamName}
          lines={away}
          selectedId={awayPlayer?.playerId ?? null}
          onSelect={setAwayPick}
        />
      </div>

      <p className="px-1 text-[11px] leading-relaxed text-foreground-subtle">
        Each player&apos;s own numbers from this match. A dash means the figure wasn&apos;t recorded for that player,
        which is not the same as nought — so a bar is only ever split when both players have a real number behind it.
      </p>
    </div>
  );
}

function ComparedPlayerHeading({
  player,
  teamName,
  align = "left",
}: {
  player: PlayerMatchLine;
  teamName: string;
  align?: "left" | "right";
}) {
  const body = (
    <>
      <span className="line-clamp-2 text-sm font-semibold leading-tight text-foreground">{player.playerName}</span>
      <span className="truncate text-[11px] text-foreground-subtle">{teamName}</span>
    </>
  );
  const classes = `flex min-w-0 flex-col gap-0.5 ${align === "right" ? "items-end text-right" : "items-start"}`;

  if (!player.playerId) return <div className={classes}>{body}</div>;
  return (
    <Link
      href={`/players/${player.playerId}`}
      className={`${classes} rounded-xl transition hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60`}
    >
      {body}
    </Link>
  );
}

function PlayerColumn({
  teamName,
  lines,
  selectedId,
  onSelect,
}: {
  teamName: string;
  lines: PlayerMatchLine[];
  selectedId: string | null;
  onSelect: (playerId: string) => void;
}) {
  if (lines.length === 0) {
    return (
      <div className="kivo-glass flex flex-col gap-2 rounded-2xl p-4">
        <h3 className="truncate text-sm font-semibold text-foreground">{teamName}</h3>
        <p className="text-xs text-foreground-muted">No individual numbers on record for this side.</p>
      </div>
    );
  }

  return (
    <div className="kivo-glass flex flex-col gap-1 rounded-2xl p-3">
      <h3 className="truncate px-1 pb-1 text-sm font-semibold text-foreground">{teamName}</h3>
      {lines.map((player, index) => {
        const selected = player.playerId === selectedId;
        const headline = headlinePlayerMetrics(player);
        return (
          <motion.button
            key={player.playerId || player.playerName}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(player.playerId)}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2, delay: staggerDelay(index, 0.02), ease: [0.22, 1, 0.36, 1] }}
            className={`flex min-h-[2.75rem] items-center gap-2 rounded-xl px-2 py-1.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
              selected ? "bg-accent/10 ring-1 ring-accent/30" : "hover:bg-foreground/5"
            }`}
          >
            <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-foreground-subtle">
              {player.minutesPlayed === null ? "" : `${player.minutesPlayed}'`}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] font-medium text-foreground">{player.playerName}</span>
              {headline.length > 0 && (
                <span className="truncate text-[11px] text-foreground-subtle">
                  {headline.map((cell) => `${cell.text} ${cell.label}`).join(" · ")}
                </span>
              )}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}
