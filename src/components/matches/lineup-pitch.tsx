"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { UserRound } from "lucide-react";
import { PitchLines } from "@/app/(app)/fantasy/pitch";
import { staggerDelay } from "@/lib/stagger";
import { describePlayerMarkers, formatMatchMinute, type TeamSheetPlayer, type TeamSheetRow } from "@/lib/football/team-sheet";

/**
 * One club's Starting XI on a pitch.
 *
 * The rebuild here is about what a team sheet is actually read for. The
 * previous version drew a shirt number and a name and stopped, which meant the
 * tab whose whole job is "who played" could not tell you who scored, who was
 * booked, or who came off — facts KIVO already held in `fixture_events` on the
 * very same page. Every marker below is a count of real rows (see
 * `buildTeamSheet`); nothing is inferred, and a player with no markers simply
 * has none rather than a row of zeroes.
 *
 * Visual language stays the fantasy squad builder's (`src/app/(app)/fantasy/
 * pitch.tsx`): the same `kivo-glass` card, the same `PitchLines` markings, the
 * same token shape — so a fan who has built a fantasy squad recognises this
 * immediately instead of learning a second pitch.
 *
 * Rows arrive furthest-forward first and are drawn top to bottom, so the
 * goalkeeper sits on their own goal line at the bottom of the card. Each row
 * is a grid of exactly as many equal columns as it has players, never a
 * centred flex-wrap: tokens are a fixed width, and a back four wrapping to
 * three-and-one draws a formation the team never played.
 */

/** playerId -> KIVO's own computed match rating. See fixture-ratings.ts. */
export type PitchRatings = Map<string, number>;

/**
 * The rating chip. Colour is never the only signal — the number itself is the
 * information, and the tone is a second read for people scanning the pitch
 * rather than reading it.
 */
export function RatingChip({ rating, size = "sm" }: { rating: number; size?: "sm" | "md" }) {
  const tone =
    rating >= 7.5
      ? "border-live/30 bg-live/15 text-live"
      : rating >= 6.5
        ? "border-accent/30 bg-accent/12 text-accent"
        : rating >= 5.5
          ? "border-hairline bg-surface-1 text-foreground-muted"
          : "border-critical/30 bg-critical/12 text-critical";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md border font-bold tabular-nums ${tone} ${
        size === "md" ? "min-w-9 px-1.5 py-0.5 text-xs" : "min-w-7 px-1 py-px text-[10px]"
      }`}
    >
      {rating.toFixed(1)}
    </span>
  );
}

/**
 * The small marks on a player's token: goals, cards, and the substitution
 * arrow. Deliberately glyph-and-shape based rather than colour alone, and
 * every one of them is also spelled out in the token's screen-reader text
 * (`describePlayerMarkers`), so nothing here is the only carrier of a fact.
 */
export function PlayerMarkers({
  player,
  className = "",
  omitSubstitution = false,
}: {
  player: TeamSheetPlayer;
  className?: string;
  /** List rows print "on 63'" in words on their own right-hand edge, so the
   * arrow would be the same fact twice in the same line. The pitch has no
   * room for words and keeps the arrow. */
  omitSubstitution?: boolean;
}) {
  const marks: { key: string; node: ReactNode }[] = [];

  if (player.goals > 0) {
    marks.push({
      key: "goals",
      node: (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold leading-none text-on-accent">
          {player.goals > 1 ? `⚽${player.goals}` : "⚽"}
        </span>
      ),
    });
  }
  if (player.ownGoals > 0) {
    marks.push({
      key: "own-goals",
      node: (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[9px] font-bold leading-none text-kivo-white">
          OG
        </span>
      ),
    });
  }
  if (player.assists > 0) {
    marks.push({
      key: "assists",
      node: (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-kivo-cyan/25 px-1 text-[9px] font-bold leading-none text-kivo-cyan">
          {player.assists > 1 ? `A${player.assists}` : "A"}
        </span>
      ),
    });
  }
  if (player.redCards > 0) {
    marks.push({ key: "red", node: <span className="h-4 w-2.5 rounded-[2px] bg-critical" /> });
  } else if (player.yellowCards > 0) {
    marks.push({ key: "yellow", node: <span className="h-4 w-2.5 rounded-[2px] bg-warning" /> });
  }
  if (player.wentOff && !omitSubstitution) {
    marks.push({
      key: "off",
      node: (
        <span className="flex h-4 items-center rounded-full bg-surface-2 px-1 text-[9px] font-semibold leading-none text-foreground-subtle">
          ↓{player.wentOff.minute}
        </span>
      ),
    });
  }
  if (player.cameOn && !omitSubstitution) {
    marks.push({
      key: "on",
      node: (
        <span className="flex h-4 items-center rounded-full bg-surface-2 px-1 text-[9px] font-semibold leading-none text-live">
          ↑{player.cameOn.minute}
        </span>
      ),
    });
  }

  if (marks.length === 0) return null;
  return (
    <span aria-hidden className={`flex flex-wrap items-center justify-center gap-0.5 ${className}`.trim()}>
      {marks.map((mark) => (
        <span key={mark.key} className="flex items-center">
          {mark.node}
        </span>
      ))}
    </span>
  );
}

function PlayerToken({
  player,
  rating,
  inViewerXI,
  isViewerCaptain,
}: {
  player: TeamSheetPlayer;
  rating: number | undefined;
  inViewerXI: boolean;
  isViewerCaptain: boolean;
}) {
  const markerText = describePlayerMarkers(player);

  const token = (
    <>
      <span className="relative flex h-9 w-9 items-center justify-center">
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-full border text-xs font-semibold text-foreground transition group-hover:bg-surface-2 group-hover:text-accent ${
            inViewerXI ? "border-accent/60 bg-accent/10 ring-2 ring-accent/50" : "border-hairline bg-surface-1"
          }`}
        >
          {player.shirtNumber ?? <UserRound className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />}
        </span>
        {isViewerCaptain && (
          <span
            title="Your captain"
            aria-label="Your captain"
            className="kivo-gradient-victory absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-on-accent ring-2 ring-background"
          >
            C
          </span>
        )}
        {rating !== undefined && (
          <span className="absolute -bottom-1.5 -left-2">
            <RatingChip rating={rating} />
          </span>
        )}
      </span>
      <span className="w-full truncate text-center text-[11px] font-medium text-foreground group-hover:text-accent">
        {player.playerName}
      </span>
      <PlayerMarkers player={player} />
      {/* Everything the badges say, in words, once. */}
      {(markerText || inViewerXI || rating !== undefined) && (
        <span className="sr-only">
          {markerText ? `${markerText}. ` : ""}
          {rating !== undefined ? `KIVO rating ${rating.toFixed(1)}. ` : ""}
          {inViewerXI ? `In your fantasy XI${isViewerCaptain ? ", your captain" : ""}.` : ""}
        </span>
      )}
    </>
  );

  if (!player.playerId) {
    return <div className="group mx-auto flex w-full min-w-0 max-w-[76px] flex-col items-center gap-1">{token}</div>;
  }
  return (
    <Link
      href={`/players/${player.playerId}`}
      className="group mx-auto flex w-full min-w-0 max-w-[76px] flex-col items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {token}
    </Link>
  );
}

export function LineupPitch({
  formation,
  rows,
  ratings,
  viewerFantasyRoster,
}: {
  formation: string | null;
  rows: TeamSheetRow[];
  /** KIVO's own computed ratings, absent for any match that isn't finished. */
  ratings?: PitchRatings;
  /** RECOMMENDATIONS.md item 294: playerId -> isCaptain, for the real
   * starters who are also starting in the viewer's own current fantasy XI
   * for this fixture's season. Optional so this file has no hard dependency
   * on the fantasy cross-reference — omitted entirely for a guest or a
   * viewer with no matching fantasy team. */
  viewerFantasyRoster?: Map<string, boolean>;
}) {
  return (
    <div className="kivo-glass relative flex flex-col gap-4 overflow-hidden rounded-2xl p-4 pb-6">
      <PitchLines />
      {formation && (
        <span className="relative self-center rounded-full border border-hairline bg-surface-1 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
          {formation}
        </span>
      )}
      <div className="relative flex flex-col gap-5 py-1">
        {rows.map((row, rowIndex) => (
          <div
            key={row.key}
            className="grid items-start gap-1.5"
            // Inline because the column count is data — a back three, four or
            // five all reach here, and Tailwind cannot generate a class for a
            // number it never sees at build time.
            style={{ gridTemplateColumns: `repeat(${row.players.length}, minmax(0, 1fr))` }}
          >
            {row.players.map((player, i) => {
              const inViewerXI = viewerFantasyRoster?.has(player.playerId) ?? false;
              return (
                <motion.div
                  key={player.playerId || player.playerName}
                  className="min-w-0"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: staggerDelay(rowIndex * 4 + i, 0.03), ease: [0.22, 1, 0.36, 1] }}
                >
                  <PlayerToken
                    player={player}
                    rating={ratings?.get(player.playerId)}
                    inViewerXI={inViewerXI}
                    isViewerCaptain={inViewerXI && Boolean(viewerFantasyRoster?.get(player.playerId))}
                  />
                </motion.div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One row of the bench, or of a starting list when the pitch cannot be drawn.
 * Same information as a token, laid out for a list: shirt number, name, what
 * happened, and the rating on the right where a list is scanned.
 */
export function TeamSheetListRow({
  player,
  rating,
  badge,
  muted = false,
}: {
  player: TeamSheetPlayer;
  rating?: number;
  /** The "Your XI" pill, passed in so this file keeps no fantasy dependency. */
  badge?: ReactNode;
  muted?: boolean;
}) {
  const markerText = describePlayerMarkers(player);
  return (
    <div className={`flex items-center gap-2 py-0.5 text-sm ${muted ? "text-foreground-muted" : "text-foreground"}`}>
      <span className="w-6 shrink-0 text-right text-xs tabular-nums text-foreground-subtle">
        {player.shirtNumber ?? "–"}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {player.playerId ? (
          <Link
            href={`/players/${player.playerId}`}
            className="truncate hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            {player.playerName}
          </Link>
        ) : (
          <span className="truncate">{player.playerName}</span>
        )}
        {badge}
        <PlayerMarkers player={player} omitSubstitution />
        {markerText && <span className="sr-only">{markerText}</span>}
      </div>
      {(player.cameOn || player.wentOff) && (
        <span aria-hidden className="shrink-0 text-[11px] tabular-nums text-foreground-subtle">
          {player.cameOn ? `on ${formatMatchMinute(player.cameOn)}` : `off ${formatMatchMinute(player.wentOff!)}`}
        </span>
      )}
      {rating !== undefined && <RatingChip rating={rating} />}
    </div>
  );
}
