"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Info, Star } from "lucide-react";
import { RatingChip } from "@/components/matches/lineup-pitch";
import { staggerDelay } from "@/lib/stagger";
import { describePlayerMarkers } from "@/lib/football/team-sheet";
import type { RatedTeamSheetPlayer, StandoutPlayer } from "@/lib/football/fixture-ratings";
import { RATING_MODEL_VERSION } from "@/lib/football/rating-engine";

/**
 * KIVO Ratings — the Match Centre's player-ratings surface.
 *
 * The rating engine (`src/lib/football/rating-engine.ts`, methodology in
 * `docs/RATING_ENGINE.md`) has been written, weighted and unit-tested in this
 * codebase for some time and nothing ever rendered a single number it
 * produced. This is the surface that does.
 *
 * ## Why this is not a fabricated number
 *
 * Every input is a row KIVO holds: goals, assists, own goals and cards counted
 * off `fixture_events`, the player's real position from their `lineups` row,
 * and the fixture's real final score. The output is a model's opinion computed
 * from those, and it is labelled as KIVO's own opinion everywhere it appears —
 * never as "the rating", never as a provider's. API-Football's free tier
 * publishes no player ratings at all, so there is nothing here being passed off
 * as somebody else's measurement.
 *
 * The engine's own refusals are carried through unchanged rather than papered
 * over: a match that has not finished is not rated, and a player with no
 * evidence of involvement — an unused substitute — has no rating rather than a
 * default one. That is why this panel lists only rated players and says how
 * many it left out.
 */

function RatedRow({ entry, index }: { entry: RatedTeamSheetPlayer; index: number }) {
  const { player, rating } = entry;
  // `describePlayerMarkers` already ends with "on at 63'" for a substitute who
  // came on, so a separate "on 63'" beside it printed the same fact twice in
  // the same line. The club is the card's own heading, not each row's.
  const subtitle = describePlayerMarkers(player) ?? (player.isStarting ? "Started" : "Named substitute");
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: staggerDelay(index, 0.025), ease: [0.22, 1, 0.36, 1] }}
      className="flex items-center gap-3 py-2"
    >
      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-foreground-subtle">{index + 1}</span>
      <div className="flex min-w-0 flex-1 flex-col">
        {player.playerId ? (
          <Link
            href={`/players/${player.playerId}`}
            className="truncate text-sm font-medium text-foreground transition hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            {player.playerName}
          </Link>
        ) : (
          <span className="truncate text-sm font-medium text-foreground">{player.playerName}</span>
        )}
        <span className="truncate text-[11px] text-foreground-subtle">{subtitle}</span>
      </div>
      {rating && <RatingChip rating={rating.kivoRating} size="md" />}
    </motion.div>
  );
}

export function PlayerRatingsView({
  homeTeamName,
  awayTeamName,
  homeRated,
  awayRated,
  standout,
  homeTeamId,
  unratedCount,
}: {
  homeTeamName: string;
  awayTeamName: string;
  /** Already ranked best-first by `rankRatedPlayers`. */
  homeRated: RatedTeamSheetPlayer[];
  awayRated: RatedTeamSheetPlayer[];
  standout: StandoutPlayer | null;
  homeTeamId: string;
  /** Named players the engine declined to rate — almost always unused
   * substitutes. Stated rather than silently omitted. */
  unratedCount: number;
}) {
  const teamNameFor = (teamId: string) => (teamId === homeTeamId ? homeTeamName : awayTeamName);

  return (
    <div className="flex flex-col gap-3">
      {standout && (
        <div className="kivo-glass-sharp flex items-center gap-3 rounded-2xl p-4">
          <span className="kivo-gradient-victory flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
            <Star className="h-5 w-5 text-on-accent" strokeWidth={1.75} aria-hidden />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
              KIVO&apos;s standout
            </span>
            {standout.player.playerId ? (
              <Link
                href={`/players/${standout.player.playerId}`}
                className="truncate text-base font-semibold text-foreground transition hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                {standout.player.playerName}
              </Link>
            ) : (
              <span className="truncate text-base font-semibold text-foreground">{standout.player.playerName}</span>
            )}
            <span className="truncate text-[11px] text-foreground-subtle">
              {teamNameFor(standout.teamId)}
              {describePlayerMarkers(standout.player) ? ` · ${describePlayerMarkers(standout.player)}` : ""}
            </span>
          </div>
          <RatingChip rating={standout.rating.kivoRating} size="md" />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[
          { name: homeTeamName, rated: homeRated },
          { name: awayTeamName, rated: awayRated },
        ].map((side) => (
          <div key={side.name} className="kivo-glass flex flex-col gap-1 rounded-2xl p-4">
            <span className="truncate text-sm font-semibold text-foreground">{side.name}</span>
            {side.rated.length === 0 ? (
              <p className="py-2 text-xs text-foreground-subtle">
                No player on this team sheet has enough on record for KIVO to rate them.
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-hairline-soft">
                {side.rated.map((entry, index) => (
                  <RatedRow key={entry.player.playerId || entry.player.playerName} entry={entry} index={index} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="kivo-glass flex items-start gap-2 rounded-2xl p-4 text-[11px] leading-relaxed text-foreground-subtle">
        <Info className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
        <p>
          These are <strong className="font-semibold text-foreground-muted">KIVO ratings</strong> (model v
          {RATING_MODEL_VERSION}) — KIVO&apos;s own numbers, computed from the goals, assists, cards and final score it
          holds for this match, weighted by the position each player was listed in. They are not an official statistic
          and they are nobody else&apos;s ratings.
          {unratedCount > 0
            ? ` ${unratedCount} named player${unratedCount === 1 ? "" : "s"} on these team sheets ${
                unratedCount === 1 ? "is" : "are"
              } not rated at all, because KIVO holds no record of them taking the pitch.`
            : ""}
        </p>
      </div>
    </div>
  );
}
