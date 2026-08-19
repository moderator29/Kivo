"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeftRight, BadgeCheck, ChevronRight, UserRound } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { TeamCrest } from "@/components/ui/team-crest";
import { staggerDelay } from "@/lib/stagger";
import { formatDate } from "@/lib/format";
import { TRANSFER_TYPE_LABEL } from "@/lib/football/transfer-labels";
import { TRANSFER_STATUS_LABEL } from "@/lib/football/transfer-status";
import { loadMoreTransfers } from "@/app/(app)/transfers/actions";
import type { TeamRef, TransferFilterParams, TransferListItem } from "@/app/(app)/transfers/shared";

function TeamLink({ team }: { team: TeamRef | null }) {
  if (!team) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2 text-xs text-foreground-subtle">
        <TeamCrest crestUrl={null} name={null} size={24} />
        Club not synced
      </span>
    );
  }
  return (
    <Link
      href={`/teams/${team.id}`}
      className="group -mx-1.5 flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-xs text-foreground transition hover:bg-surface-2 hover:text-accent"
    >
      <TeamCrest crestUrl={team.crest_url} name={team.name} size={24} />
      <span className="truncate transition-transform group-hover:translate-x-0.5">{team.short_name ?? team.name}</span>
    </Link>
  );
}

/**
 * `/transfers`' card list plus a "Load more" button that appends the next
 * page via `loadMoreTransfers` (offset-based, same pattern as
 * `TeamsGrid`/`LeaguesList` — audit item 2: this list used to hard-cap at
 * 50 rows with no way to reach anything older). `filters` are the same
 * validated type/club/from/to the page itself already queried with, passed
 * straight through to each "Load more" call so it keeps appending pages of
 * the same filtered result set. A filter change itself triggers a full
 * navigation (`TransfersFilters` pushes a new URL), which remounts this
 * component from a fresh server render — so `filters` never needs to change
 * out from under an already-mounted list.
 */
export function TransfersList({
  initialTransfers,
  initialHasMore,
  filters,
}: {
  initialTransfers: TransferListItem[];
  initialHasMore: boolean;
  filters: TransferFilterParams;
}) {
  const [transfers, setTransfers] = useState(initialTransfers);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  function handleLoadMore() {
    setError(null);
    startLoading(async () => {
      const result = await loadMoreTransfers(transfers.length, filters);
      if (result.error) {
        setError(result.error);
        return;
      }
      setTransfers((prev) => [...prev, ...result.transfers]);
      setHasMore(result.hasMore);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {transfers.map((transfer, index) => {
        const playerName = transfer.player ? (transfer.player.known_as ?? transfer.player.full_name) : null;

        return (
          <FadeIn key={transfer.id} delay={staggerDelay(index % 50, 0.03)}>
            <div className="kivo-glass flex flex-col gap-3 rounded-2xl p-4 transition hover:bg-surface-2">
              <div className="flex items-center justify-between gap-3">
                {transfer.player && playerName ? (
                  <Link
                    href={`/players/${transfer.player.id}`}
                    className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground transition hover:text-accent"
                  >
                    <UserRound className="h-4 w-4 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
                    <span className="truncate">{playerName}</span>
                  </Link>
                ) : (
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground-subtle">
                    <UserRound className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                    Unknown player
                  </span>
                )}
                <span className="shrink-0 text-xs tabular-nums text-foreground-subtle">
                  {formatDate(transfer.transfer_date, { month: "short" })}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <TeamLink team={transfer.from_team} />
                <ArrowLeftRight
                  className="h-3.5 w-3.5 shrink-0 animate-[kivo-transfer-arrow-nudge_3.4s_ease-in-out_infinite] text-foreground-subtle"
                  strokeWidth={2}
                />
                <TeamLink team={transfer.to_team} />
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-hairline-soft pt-3">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {/* The only status KIVO's transfer data supports. The page
                      header explains why there is not a second one, rather
                      than the product quietly shipping fewer filters than the
                      spec asked for. See transfer-status.ts. */}
                  <span className="flex items-center gap-1 rounded-full border border-live/40 bg-live/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-live">
                    <BadgeCheck className="h-3 w-3" strokeWidth={2} />
                    {TRANSFER_STATUS_LABEL}
                  </span>
                  <span className="rounded-full border border-hairline px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
                    {TRANSFER_TYPE_LABEL[transfer.transfer_type]}
                  </span>
                  {/* A fee that was never disclosed is not a dash and is not a
                      zero — the chip simply is not there. */}
                  {transfer.fee_text && (
                    <span className="rounded-full border border-achievement/40 bg-achievement/10 px-2 py-0.5 text-[11px] font-semibold text-achievement">
                      {transfer.fee_text}
                    </span>
                  )}
                </div>
                <Link
                  href={`/transfers/${transfer.id}`}
                  className="kivo-focus flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-accent transition hover:text-accent-strong"
                >
                  Details
                  <ChevronRight className="h-3 w-3" strokeWidth={2} />
                </Link>
              </div>
            </div>
          </FadeIn>
        );
      })}

      {error && (
        <p className="text-center text-xs text-critical" role="status" aria-live="polite">
          {error}
        </p>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={loading}
          className="self-center rounded-xl border border-hairline px-4 py-2 text-xs font-semibold text-foreground-muted transition hover:bg-surface-2 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
