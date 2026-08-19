"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { UserRoundCog } from "lucide-react";
import { LineupPitch, TeamSheetListRow } from "@/components/matches/lineup-pitch";
import { staggerDelay } from "@/lib/stagger";
import type { TeamSheet } from "@/lib/football/team-sheet";

/**
 * The Lineups tab: two real team sheets, side by side.
 *
 * Three things this fixes about the tab it replaces, all of them the kind that
 * only show up once you read the two halves as one comparison:
 *
 *  1. **It was a pair of name lists.** The events that make a team sheet worth
 *     reading — who scored, who was booked, who came off and when — were
 *     already fetched for the Timeline tab on the same page and never reached
 *     this one. They do now, via `buildTeamSheet`.
 *  2. **The bench was a footnote.** It is a distinct section with its own
 *     heading, used substitutes first, each carrying the minute they came on.
 *  3. **The manager was missing entirely** from the tab that names the eleven
 *     they picked, despite being on the page header already.
 *
 * The like-for-like rule from the previous version stays, because it was
 * right: the positioned pitch is drawn only when **both** sides can draw one.
 * A side-by-side where one half is a pitch and the other a list invites exactly
 * the wrong read — that one team's shape is known and the other's is unusual,
 * rather than that KIVO's data for one side is incomplete.
 */

export type ManagerRef = { id: string; name: string } | null;

function ManagerLine({ manager }: { manager: ManagerRef }) {
  if (!manager) return null;
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-foreground-subtle">
      <UserRoundCog className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      <span className="sr-only">Manager: </span>
      <Link
        href={`/managers/${manager.id}`}
        className="truncate transition hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        {manager.name}
      </Link>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">{children}</span>
  );
}

function TeamSheetColumn({
  teamName,
  sheet,
  manager,
  ratings,
  drawPitch,
  renderBadge,
  viewerFantasyRoster,
}: {
  teamName: string;
  sheet: TeamSheet;
  manager: ManagerRef;
  ratings: Map<string, number>;
  drawPitch: boolean;
  renderBadge: (playerId: string) => ReactNode;
  viewerFantasyRoster: Map<string, boolean>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold text-foreground">{teamName}</span>
          <ManagerLine manager={manager} />
        </div>
        {sheet.formation && (
          <span className="shrink-0 rounded-full border border-hairline bg-surface-1 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
            {sheet.formation}
          </span>
        )}
      </div>

      {drawPitch && sheet.rows ? (
        <LineupPitch formation={null} rows={sheet.rows} ratings={ratings} viewerFantasyRoster={viewerFantasyRoster} />
      ) : (
        sheet.starters.length > 0 && (
          <div className="flex flex-col gap-1">
            <SectionLabel>Starting XI</SectionLabel>
            {sheet.starters.map((player, index) => (
              <motion.div
                key={player.playerId || player.playerName}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, delay: staggerDelay(index, 0.03), ease: [0.22, 1, 0.36, 1] }}
              >
                <TeamSheetListRow
                  player={player}
                  rating={ratings.get(player.playerId)}
                  badge={renderBadge(player.playerId)}
                />
              </motion.div>
            ))}
          </div>
        )
      )}

      {sheet.bench.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <SectionLabel>Bench</SectionLabel>
            {/* The count is the honest caption for a bench: a named squad of
                nine with two used is a different picture from a bench of five,
                and the difference is a real, countable one. */}
            <span className="text-[10px] uppercase tracking-wide text-foreground-subtle">
              {sheet.bench.filter((player) => player.cameOn).length} of {sheet.bench.length} used
            </span>
          </div>
          {sheet.bench.map((player, index) => (
            <motion.div
              key={player.playerId || player.playerName}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2, delay: 0.1 + staggerDelay(index, 0.03), ease: [0.22, 1, 0.36, 1] }}
            >
              <TeamSheetListRow
                player={player}
                rating={ratings.get(player.playerId)}
                badge={renderBadge(player.playerId)}
                muted={!player.cameOn}
              />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TeamSheetView({
  homeTeamName,
  awayTeamName,
  homeSheet,
  awaySheet,
  homeManager,
  awayManager,
  ratings,
  renderBadge,
  viewerFantasyRoster,
}: {
  homeTeamName: string;
  awayTeamName: string;
  homeSheet: TeamSheet;
  awaySheet: TeamSheet;
  homeManager: ManagerRef;
  awayManager: ManagerRef;
  /** playerId -> KIVO's computed rating, across both sides. Empty for any
   * match that has not finished. */
  ratings: Map<string, number>;
  renderBadge: (playerId: string) => ReactNode;
  /** RECOMMENDATIONS.md item 294: playerId -> isCaptain for the viewer's own
   * current fantasy XI in this fixture's season. Empty for a guest. */
  viewerFantasyRoster: Map<string, boolean>;
}) {
  const drawPitch = homeSheet.rows !== null && awaySheet.rows !== null;
  const bothFormations = Boolean(homeSheet.formation && awaySheet.formation);
  // Only ever true when both sides drew from the provider's own formation
  // slots — a caption claiming real lines while one half was bucketed by
  // position letter would be the misleading half of a true sentence.
  const fromFormationSlots =
    drawPitch && homeSheet.rowBasis === "formation-slot" && awaySheet.rowBasis === "formation-slot";

  return (
    <div className="flex flex-col gap-3">
      {/* The shape comparison. Only rendered when both sides have a real
          formation — one formation next to a blank is not a comparison, and a
          dash in place of the missing one would read as a claim about the team
          rather than about KIVO's data. */}
      {bothFormations && (
        <div className="kivo-glass-sharp flex items-center justify-center gap-3 rounded-xl px-4 py-2.5 text-sm">
          <span className="font-semibold text-foreground">{homeSheet.formation}</span>
          <span className="text-[11px] uppercase tracking-wide text-foreground-subtle">shape</span>
          <span className="font-semibold text-foreground">{awaySheet.formation}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="kivo-glass rounded-2xl p-4">
          <TeamSheetColumn
            teamName={homeTeamName}
            sheet={homeSheet}
            manager={homeManager}
            ratings={ratings}
            drawPitch={drawPitch}
            renderBadge={renderBadge}
            viewerFantasyRoster={viewerFantasyRoster}
          />
        </div>
        <div className="kivo-glass rounded-2xl p-4">
          <TeamSheetColumn
            teamName={awayTeamName}
            sheet={awaySheet}
            manager={awayManager}
            ratings={ratings}
            drawPitch={drawPitch}
            renderBadge={renderBadge}
            viewerFantasyRoster={viewerFantasyRoster}
          />
        </div>
      </div>

      {/* Said once, for the whole tab, rather than left for the reader to
          infer from two lists where they expected two pitches. */}
      {!drawPitch && (homeSheet.starters.length > 0 || awaySheet.starters.length > 0) && (
        <p className="px-1 text-[11px] leading-relaxed text-foreground-subtle">
          Both sides are shown as lists: a positioned pitch is only drawn when every starter on <em>both</em> teams has a
          real position on record, and one of these team sheets doesn&apos;t yet. Showing one pitch and one list would
          suggest KIVO knows more about one team&apos;s shape than the other.
        </p>
      )}

      {/* The rating chips on the tokens and rows above are KIVO's own model
          output, and a number on a player's shirt reads as official unless it
          says otherwise. It says otherwise here, on the tab where it appears,
          rather than only on the Ratings tab a reader may never open. */}
      {ratings.size > 0 && (
        <p className="px-1 text-[11px] leading-relaxed text-foreground-subtle">
          The number beside each player is a <strong className="font-semibold text-foreground-muted">KIVO rating</strong>{" "}
          — KIVO&apos;s own read of the match, computed from its goals, assists, cards and final score. It is not an
          official rating and it is nobody else&apos;s. The Ratings tab shows the full ranking and the method.
        </p>
      )}

      {drawPitch && (
        <p className="px-1 text-[11px] leading-relaxed text-foreground-subtle">
          {fromFormationSlots
            ? "Lines come from each club's own team sheet, so the depth of the shape is real. Which side of the pitch a player occupied is not something KIVO has, so the order within a line is the team sheet's own and not a claim about flanks."
            : "Players are grouped by their listed position — goalkeeper, defence, midfield, attack. KIVO has no formation slots for this match, so the bands are real but the finer shape within them is not shown."}
        </p>
      )}
    </div>
  );
}
