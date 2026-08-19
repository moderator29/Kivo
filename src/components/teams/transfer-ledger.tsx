import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { TeamCrest } from "@/components/ui/team-crest";
import { ListSurface } from "@/components/football/entity-shell";
import { TRANSFER_TYPE_LABEL } from "@/lib/football/transfer-labels";
import { formatDate } from "@/lib/format";
import type { Database } from "@/lib/supabase/types";

/**
 * A club's transfer ledger, split into arrivals and departures.
 *
 * Each transfer used to be its own glass card with three internal rows — so
 * fifteen signings were fifteen boxes, forty-five internal borders and a
 * section taller than the squad list. It is a ledger; a ledger is rows.
 *
 * Direction is the split, not a badge, because "who did we sign" and "who did
 * we lose" are the two questions a fan actually arrives with, and interleaving
 * them by date answers neither without the reader doing the sorting themselves.
 *
 * A fee is printed only when the record carries one. `fee_text` is free text
 * from the source ("Free", "€45m", "Loan") and it is passed through untouched
 * rather than parsed into a number — a fee KIVO cannot parse is still a fee a
 * fan can read, and a parsed one would be a currency conversion nobody asked
 * for.
 */
export type TransferLedgerEntry = {
  id: string;
  playerId: string | null;
  playerName: string | null;
  direction: "in" | "out";
  counterpartTeam: { id: string; name: string; short_name: string | null; crest_url: string | null } | null;
  transferDate: string;
  feeText: string | null;
  transferType: Database["public"]["Enums"]["transfer_type"];
};

function TransferRow({ entry }: { entry: TransferLedgerEntry }) {
  const counterpartLabel = entry.counterpartTeam
    ? (entry.counterpartTeam.short_name ?? entry.counterpartTeam.name)
    : "Club not listed";

  const body = (
    <>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">{entry.playerName ?? "Player not listed"}</p>
        <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-foreground-subtle">
          {entry.direction === "in" ? "from" : "to"}
          <TeamCrest crestUrl={entry.counterpartTeam?.crest_url ?? null} name={counterpartLabel} size={14} />
          <span className="truncate">{counterpartLabel}</span>
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="text-xs font-semibold tabular-nums text-foreground">{entry.feeText ?? "–"}</span>
        <span className="text-[10px] uppercase tracking-[0.06em] text-foreground-subtle">
          {TRANSFER_TYPE_LABEL[entry.transferType]} · {formatDate(entry.transferDate, { month: "short" })}
        </span>
      </div>
    </>
  );

  return (
    <li>
      {entry.playerId ? (
        <Link
          href={`/players/${entry.playerId}`}
          className="kivo-focus flex min-h-[3.25rem] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-2"
        >
          {body}
        </Link>
      ) : (
        <div className="flex min-h-[3.25rem] items-center gap-3 px-3 py-2.5">{body}</div>
      )}
    </li>
  );
}

export function TransferLedger({ entries }: { entries: TransferLedgerEntry[] }) {
  const arrivals = entries.filter((entry) => entry.direction === "in");
  const departures = entries.filter((entry) => entry.direction === "out");

  return (
    <div className="flex flex-col gap-4">
      {[
        { title: "In", icon: <ArrowDownLeft className="h-3.5 w-3.5 text-live" strokeWidth={2} />, rows: arrivals },
        { title: "Out", icon: <ArrowUpRight className="h-3.5 w-3.5 text-critical" strokeWidth={2} />, rows: departures },
      ]
        .filter((group) => group.rows.length > 0)
        .map((group) => (
          <div key={group.title} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3 px-1">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-foreground-subtle">
                {group.icon}
                {group.title}
              </span>
              <span className="text-[11px] tabular-nums text-foreground-subtle">{group.rows.length}</span>
            </div>
            <ListSurface>
              {group.rows.map((entry) => (
                <TransferRow key={entry.id} entry={entry} />
              ))}
            </ListSurface>
          </div>
        ))}
    </div>
  );
}
