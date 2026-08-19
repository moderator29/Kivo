import { Users } from "lucide-react";
import Link from "next/link";
import { FadeIn } from "@/components/ui/fade-in";
import { TRANSFER_TYPE_LABEL } from "@/lib/football/transfer-labels";
import type { ClubLeagueLine, PlayerRecord, SquadShape, TransferTimelineEntry } from "@/lib/football/transfer-context";
import { formatDate } from "@/lib/format";

/**
 * The two dense panels on a transfer's page: the player's recorded moves, and
 * the counted facts around the move.
 *
 * Lifted out of `transfers/[id]/page.tsx` with the markup unchanged. Two
 * reasons, and the second is the one that mattered: the page was carrying four
 * hundred lines of markup around its data loading, and a panel that lives
 * inside a server component doing its own queries cannot be put in front of a
 * browser at 390px without a live database behind it. As props, both can.
 *
 * Neither renders anything when it has nothing real — an empty timeline and a
 * fully-null fact set both return null rather than an empty card.
 */

/** Matches the ordinal rule the share cards use (`ordinal` in
 * src/lib/share-cards/build.ts); a suffix-only helper because this call site
 * renders the number itself. */
export function ordinalSuffix(value: number): string {
  const abs = Math.abs(value) % 100;
  if (abs >= 11 && abs <= 13) return "th";
  return ["th", "st", "nd", "rd"][Math.min(abs % 10, 4)] ?? "th";
}

export function TransferTimeline({ playerName, timeline }: { playerName: string; timeline: TransferTimelineEntry[] }) {
  if (timeline.length === 0) return null;

  return (
    <FadeIn delay={0.09} className="kivo-glass flex flex-col gap-4 rounded-2xl p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-foreground">{playerName}&apos;s recorded moves</h2>
        <p className="text-xs text-foreground-muted">
          {timeline.length === 1
            ? "One move on record."
            : `${timeline.length} moves on record, newest first.`}
        </p>
      </div>
      <ol className="flex flex-col gap-0">
        {timeline.map((entry, index) => (
          <li key={entry.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${entry.isCurrent ? "bg-accent ring-4 ring-accent/20" : "bg-hairline-strong"}`}
                aria-hidden="true"
              />
              {index < timeline.length - 1 && <span className="w-px flex-1 bg-hairline" aria-hidden="true" />}
            </div>
            {/* The last entry drops its bottom padding — otherwise the card ends in
                a band of dead space under the oldest move. */}
            <div
              className={`flex min-w-0 flex-1 flex-col gap-0.5 ${index < timeline.length - 1 ? "pb-5" : ""} ${entry.isCurrent ? "" : "opacity-80"}`}
            >
              <span className="text-xs text-foreground-subtle">{formatDate(entry.transferDate)}</span>
              {entry.isCurrent ? (
                <span className="truncate text-sm font-semibold text-foreground">
                  {entry.fromTeamName ?? "Club not listed"} → {entry.toTeamName ?? "Club not listed"}
                </span>
              ) : (
                <Link
                  href={`/transfers/${entry.id}`}
                  className="kivo-focus truncate text-sm font-medium text-foreground hover:text-accent"
                >
                  {entry.fromTeamName ?? "Club not listed"} → {entry.toTeamName ?? "Club not listed"}
                </Link>
              )}
              <span className="text-[11px] text-foreground-subtle">
                {TRANSFER_TYPE_LABEL[entry.transferType]}
                {entry.feeText ? ` · ${entry.feeText}` : ""}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </FadeIn>
  );
}

export function TransferFacts({
  playerName,
  toTeamName,
  playerPosition,
  record,
  squad,
  leagueLine,
}: {
  playerName: string;
  toTeamName: string | null;
  playerPosition: string | null;
  record: PlayerRecord | null;
  squad: SquadShape | null;
  leagueLine: ClubLeagueLine | null;
}) {
  if (!record && !squad && !leagueLine) return null;

  return (
    <FadeIn delay={0.12} className="kivo-glass flex flex-col gap-4 rounded-2xl p-5">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Users className="h-4 w-4 text-accent" strokeWidth={1.75} />
          What the data says
        </h2>
        <p className="text-xs text-foreground-muted">
          Counted from real matches. Not a verdict on the move — KIVO has no data that could
          support one.
        </p>
      </div>

      {record && (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
            {playerName}&apos;s record
          </span>
          {/* Assists are dropped rather than zeroed when unknown, and the
              wide grid follows the real cell count so the row never ends
              in a single orphaned tile. */}
          <div className={`grid grid-cols-3 gap-2 ${record.assists !== null ? "sm:grid-cols-6" : "sm:grid-cols-5"}`}>
            {[
              { label: "Apps", value: record.appearances },
              { label: "Starts", value: record.starts },
              { label: "Goals", value: record.goals },
              ...(record.assists !== null ? [{ label: "Assists", value: record.assists }] : []),
              { label: "Yellow", value: record.yellowCards },
              { label: "Red", value: record.redCards },
            ].map((cell) => (
              <div key={cell.label} className="flex flex-col items-center rounded-xl border border-hairline bg-surface-1 p-2">
                <span className="text-base font-semibold tabular-nums text-foreground">{cell.value}</span>
                <span className="text-[10px] uppercase tracking-wide text-foreground-subtle">{cell.label}</span>
              </div>
            ))}
          </div>
          <span className="text-[11px] text-foreground-subtle">
            Across every match KIVO has on record for this player.
          </span>
        </div>
      )}

      {squad && (
        <div className="flex flex-col gap-2 border-t border-hairline-soft pt-4">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
            {squad.teamName}&apos;s squad, as KIVO holds it
          </span>
          <div className="flex flex-wrap gap-2">
            {squad.byPosition.map((entry) => (
              <span
                key={entry.group}
                className="rounded-full border border-hairline px-2.5 py-1 text-[11px] text-foreground-muted"
              >
                {entry.group} <span className="font-semibold tabular-nums text-foreground">{entry.count}</span>
              </span>
            ))}
          </div>
          <span className="text-[11px] text-foreground-subtle">
            {squad.syncedPlayerCount} player{squad.syncedPlayerCount === 1 ? "" : "s"} at {squad.teamName}
            {squad.countInPlayerPosition != null && playerPosition
              ? `, of whom ${squad.countInPlayerPosition} play ${playerPosition.toLowerCase()}.`
              : "."}
          </span>
        </div>
      )}

      {leagueLine && (
        <div className="flex flex-col gap-2 border-t border-hairline-soft pt-4">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
            {toTeamName} in {leagueLine.competitionName}
          </span>
          <p className="text-xs leading-relaxed text-foreground-muted">
            {leagueLine.position != null ? `${leagueLine.position}${ordinalSuffix(leagueLine.position)}, ` : ""}
            {leagueLine.points} point{leagueLine.points === 1 ? "" : "s"} from {leagueLine.played} match
            {leagueLine.played === 1 ? "" : "es"} — {leagueLine.goalsFor} scored, {leagueLine.goalsAgainst}{" "}
            conceded, in {leagueLine.seasonName}.
          </p>
        </div>
      )}
    </FadeIn>
  );
}
