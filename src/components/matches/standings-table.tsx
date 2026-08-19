"use client";

import { motion } from "motion/react";
import { TeamCrest } from "@/components/ui/team-crest";
import { staggerDelay } from "@/lib/stagger";

/**
 * The league table, with its zones drawn — and without KIVO claiming a single
 * one of them.
 *
 * ## The rule
 *
 * A table without zones is a list of numbers. What makes it football is that
 * there is a line under fourth and a line above eighteenth, and that everyone
 * reading it knows what those lines mean. The tempting way to draw them is to
 * hardcode "top four is the Champions League" per competition, and that is an
 * unverifiable claim with an expiry date: coefficients move, leagues
 * restructure, a country gains or loses a place, and a line drawn confidently
 * in the wrong position is worse than no line.
 *
 * KIVO does not have to claim anything, because the competition states it.
 * `standings.zone_description` (migration 0117) is the phrase as published —
 * "Promotion - Champions League (Group Stage)", "Relegation - Championship" —
 * and it is stored verbatim rather than bucketed at write time.
 *
 * So: **colour what can be classified, and show the phrase either way.** The
 * colour is a presentation choice made over text that is still intact; the
 * text is the fact. A zone this file cannot classify still gets its row marked
 * and its phrase into the key, because the phrase is true whether or not KIVO
 * recognises the words in it.
 */

export type StandingsRow = {
  teamId: string;
  teamName: string;
  crestUrl: string | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  position: number | null;
  /** The competition's own phrase for this line of the table, verbatim, or
   * null where it published none. */
  zoneDescription: string | null;
  /** "Group A" — a group stage is eight tables, not one 32-row ladder, and
   * `position` is per group. Null for a straight league. */
  groupLabel: string | null;
};

export type ZoneTone = "up" | "secondary" | "down" | "unclassified";

/**
 * Which colour a published zone phrase gets.
 *
 * Deliberately conservative, and deliberately not exhaustive. It recognises
 * the shapes that hold across competitions — the top prize, a lesser or
 * conditional place, and the drop — and calls everything else unclassified
 * rather than guessing. An unrecognised phrase is not a failure: it still
 * marks its rows and still appears in the key, in the competition's own words.
 *
 * Order is the whole design. "Relegation Play-off" is a way down, not a way
 * up, and "Promotion - Europa League" is a promotion phrase describing the
 * second prize rather than the first — so the specific competition names are
 * read before the generic promotion wording, and relegation is read before
 * everything.
 */
export function classifyStandingsZone(description: string | null): ZoneTone | null {
  if (!description) return null;
  const text = description.toLowerCase();
  const conditional = text.includes("play-off") || text.includes("playoff") || text.includes("play off");

  if (text.includes("relegation") || text.includes("relegated")) return conditional ? "secondary" : "down";
  if (text.includes("europa") || text.includes("conference")) return "secondary";
  if (text.includes("champions league") || text.includes("promotion") || text.includes("promoted")) {
    // A qualifying round is a chance at the place, not the place.
    return conditional || text.includes("qualif") ? "secondary" : "up";
  }
  if (conditional || text.includes("qualif")) return "secondary";
  return "unclassified";
}

const ZONE_BAR: Record<ZoneTone, string> = {
  up: "bg-accent",
  secondary: "bg-kivo-cyan",
  down: "bg-critical",
  unclassified: "bg-foreground-subtle",
};

/** One entry per distinct phrase actually present in this table, in the order
 * the table first reaches it — so the key reads top-down like the table does. */
export function zoneKey(rows: StandingsRow[]): { description: string; tone: ZoneTone }[] {
  const seen = new Map<string, ZoneTone>();
  for (const row of rows) {
    const tone = classifyStandingsZone(row.zoneDescription);
    if (!tone || !row.zoneDescription) continue;
    if (!seen.has(row.zoneDescription)) seen.set(row.zoneDescription, tone);
  }
  return [...seen.entries()].map(([description, tone]) => ({ description, tone }));
}

/** A group stage is several tables. Returns one entry per group in first-seen
 * order, or a single unlabelled entry for an ordinary league. */
export function groupStandings(rows: StandingsRow[]): { label: string | null; rows: StandingsRow[] }[] {
  const labels = [...new Set(rows.map((row) => row.groupLabel))];
  if (labels.length <= 1) return [{ label: labels[0] ?? null, rows }];
  return labels.map((label) => ({ label, rows: rows.filter((row) => row.groupLabel === label) }));
}

export function StandingsTable({
  standings,
  homeTeamId,
  awayTeamId,
}: {
  standings: StandingsRow[];
  homeTeamId: string;
  awayTeamId: string;
}) {
  const groups = groupStandings(standings);
  const key = zoneKey(standings);

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <div key={group.label ?? "table"} className="flex flex-col gap-2">
          {group.label && (
            <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
              {group.label}
            </h3>
          )}
          {/* No minimum width. The table used to be laid out at 26rem and left
              to scroll horizontally on a phone, which put POINTS — the column
              the whole table is sorted by and the only one anybody opens it
              for — off the right-hand edge of a 390px screen. A club name is
              the one thing here that can be truncated without costing the
              reader the fact they came for, so that is what gives. */}
          <div className="kivo-glass overflow-x-auto rounded-2xl">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
                  <th scope="col" className="py-2 pl-3 pr-1 text-left font-semibold">
                    #
                  </th>
                  <th scope="col" className="py-2 text-left font-semibold">
                    Team
                  </th>
                  {/* Played is the least-consulted of the three numbers and
                      the first to go when a phone is the whole width there is.
                      Dropping it here buys the club-name column about thirty
                      pixels, which is the difference between "Northgate
                      Rovers" and "North…" for the two clubs a reader opened
                      this table to find. */}
                  <th scope="col" className="hidden px-1 py-2 text-right font-semibold sm:table-cell">
                    P
                  </th>
                  <th scope="col" className="px-1 py-2 text-right font-semibold">
                    GD
                  </th>
                  <th scope="col" className="py-2 pl-1 pr-3 text-right font-semibold">
                    Pts
                  </th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row, index) => {
                  const highlighted = row.teamId === homeTeamId || row.teamId === awayTeamId;
                  const tone = classifyStandingsZone(row.zoneDescription);
                  return (
                    <motion.tr
                      key={row.teamId}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: staggerDelay(index, 0.03), ease: [0.22, 1, 0.36, 1] }}
                      className={highlighted ? "bg-accent/5" : ""}
                    >
                      <td className="py-2 pl-3 pr-1 text-foreground-subtle">
                        <span className="flex items-center gap-2">
                          {/* The zone marker. Never the only carrier of the
                              fact — the phrase itself is in the key below and
                              on the row's own screen-reader text — so a reader
                              who cannot see the colour loses nothing. */}
                          <span
                            aria-hidden
                            className={`h-4 w-0.5 rounded-full ${tone ? ZONE_BAR[tone] : "bg-transparent"}`}
                          />
                          <span className="tabular-nums">{row.position ?? "-"}</span>
                        </span>
                      </td>
                      {/* `w-full` rather than `max-w-0`: this is the column
                          that should absorb whatever the numbers do not use,
                          and `max-w-0` had it giving space back instead of
                          taking it, so a club name truncated with sixty
                          unused pixels sitting beside it. */}
                      <td className="w-full py-2 text-foreground">
                        <span className="flex min-w-0 items-center gap-2">
                          <TeamCrest crestUrl={row.crestUrl} name={row.teamName} size={16} />
                          <span className="truncate">{row.teamName}</span>
                          {row.zoneDescription && <span className="sr-only">, {row.zoneDescription}</span>}
                        </span>
                      </td>
                      <td className="hidden px-1 py-2 text-right text-foreground-muted tabular-nums sm:table-cell">{row.played}</td>
                      <td className="px-1 py-2 text-right text-foreground-muted tabular-nums">
                        {row.goalsFor - row.goalsAgainst}
                      </td>
                      <td className="py-2 pl-1 pr-3 text-right font-semibold text-foreground tabular-nums">{row.points}</td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {key.length > 0 && (
        <div className="flex flex-col gap-1.5 px-1">
          {key.map((entry) => (
            <div key={entry.description} className="flex items-center gap-2 text-[11px] text-foreground-muted">
              <span aria-hidden className={`h-3 w-0.5 shrink-0 rounded-full ${ZONE_BAR[entry.tone]}`} />
              <span className="min-w-0">{entry.description}</span>
            </div>
          ))}
          {/* Said once, because a fan is entitled to know whose line it is. */}
          <p className="pt-0.5 text-[11px] leading-relaxed text-foreground-subtle">
            The zones are the competition&apos;s own, in its own words — KIVO doesn&apos;t decide where the lines go.
          </p>
        </div>
      )}
    </div>
  );
}
