"use client";

import { useState } from "react";
import Link from "next/link";
import { TeamCrest } from "@/components/ui/team-crest";
import { RatingChip } from "@/components/matches/lineup-pitch";
import { ListSurface } from "@/components/ui/list-surface";
import { CappedListFooter } from "@/components/ui/capped-list-footer";
import { formatDate } from "@/lib/format";
import type { FormResult } from "@/lib/football/results";
import type { PlayerMatchEntry } from "@/components/players/player-career";

/**
 * Every match KIVO has this player in, one row each.
 *
 * ## Why the page needed this
 *
 * The player page could tell you a career total and it could tell you a form
 * strip, and there was nothing in between — no way to see the match those
 * numbers came from, which is the thing a fan actually argues about. Every
 * reference product has this list and it is usually the most-read part of a
 * player page.
 *
 * ## What each row says
 *
 * The opponent and the real scoreline from this player's own team's side, then
 * what this player did in it: minutes if the provider reported them, goals,
 * assists, cards, and KIVO's own computed match rating.
 *
 * Every one of those is absent when it is not real. No "0 goals" chip — a row
 * with no contributions simply carries none. No "90'" for a starter whose
 * minutes were never reported. And the rating is `null` for an unused
 * substitute, because the engine refuses to rate somebody it has no evidence
 * played (see `rating-engine.ts`), which is exactly the case where a default
 * 6.0 would be a fabrication.
 *
 * ## Why it is capped
 *
 * A player with a long career in KIVO's coverage could have hundreds of rows,
 * and a page that renders all of them is slow to open for the sake of a list
 * almost nobody scrolls to the end of. It shows the most recent window and says
 * how many of how many — the shared `CappedListFooter` rule, so this list stops
 * the same way every other capped list in the product does.
 */

/** How many matches are on screen before the reader asks for more, and how
 * many arrive each time they do. Fifteen fills a phone screen twice over. */
const MATCH_LOG_WINDOW = 15;
export type MatchLogRow = PlayerMatchEntry & {
  opponentName: string;
  opponentShortName: string | null;
  opponentCrestUrl: string | null;
  competitionLabel: string | null;
};

const RESULT_CHIP: Record<FormResult, string> = {
  W: "border-live/30 bg-live/10 text-live",
  D: "border-hairline bg-surface-2 text-foreground-muted",
  L: "border-critical/30 bg-critical/10 text-critical",
};

function Contribution({ label, value, tone }: { label: string; value: number; tone: string }) {
  if (value <= 0) return null;
  return (
    <span className={`rounded border px-1.5 py-px text-[10px] font-semibold tabular-nums ${tone}`}>
      {value} {label}
    </span>
  );
}

export function PlayerMatchLog({ rows }: { rows: MatchLogRow[] }) {
  const [visible, setVisible] = useState(MATCH_LOG_WINDOW);
  const shown = rows.slice(0, visible);

  return (
    <div className="flex flex-col gap-3">
    <ListSurface>
      {shown.map((row) => {
        const contributions = [
          { key: "g", label: row.goals === 1 ? "goal" : "goals", value: row.goals, tone: "border-live/30 bg-live/10 text-live" },
          {
            key: "a",
            label: row.assists === 1 ? "assist" : "assists",
            value: row.assists,
            tone: "border-accent/30 bg-accent/10 text-accent",
          },
          {
            key: "og",
            label: row.ownGoals === 1 ? "own goal" : "own goals",
            value: row.ownGoals,
            tone: "border-critical/30 bg-critical/10 text-critical",
          },
          { key: "y", label: "yellow", value: row.yellowCards, tone: "border-warning/30 bg-warning/10 text-warning" },
          { key: "r", label: "red", value: row.redCards, tone: "border-critical/30 bg-critical/10 text-critical" },
        ].filter((chip) => chip.value > 0);

        const secondLine = [
          formatDate(row.kickoffAt, { month: "short" }),
          row.competitionLabel,
          row.isHome ? "Home" : "Away",
          row.minutesPlayed !== null ? `${row.minutesPlayed}'` : null,
          !row.isStarting && row.cameOnFromBench ? "Off the bench" : null,
        ]
          .filter(Boolean)
          .join(" · ");

        return (
          <li key={row.fixtureId}>
            <Link
              href={`/matches/${row.fixtureId}`}
              className="kivo-focus flex min-h-11 flex-col gap-1.5 px-4 py-3 transition-colors duration-150 hover:bg-surface-2 motion-reduce:transition-none"
            >
              <span className="flex items-center gap-3">
                <TeamCrest crestUrl={row.opponentCrestUrl} name={row.opponentName} size={22} />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {row.opponentShortName ?? row.opponentName}
                </span>
                {row.ownScore !== null && row.oppScore !== null && (
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                    {row.ownScore}–{row.oppScore}
                  </span>
                )}
                {row.result && (
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${RESULT_CHIP[row.result]}`}
                  >
                    {row.result}
                  </span>
                )}
                {row.rating && <RatingChip rating={row.rating.kivoRating} size="md" />}
              </span>
              <span className="flex flex-wrap items-center gap-1.5 pl-[2.375rem]">
                <span className="text-xs text-foreground-subtle">{secondLine}</span>
                {contributions.map((chip) => (
                  <Contribution key={chip.key} label={chip.label} value={chip.value} tone={chip.tone} />
                ))}
              </span>
            </Link>
          </li>
        );
      })}
    </ListSurface>
      <CappedListFooter
        visible={shown.length}
        total={rows.length}
        onShowMore={() => setVisible((current) => current + MATCH_LOG_WINDOW)}
        label="matches"
      />
    </div>
  );
}
