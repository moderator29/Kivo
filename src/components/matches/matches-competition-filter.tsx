"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CompetitionFilter, type CompetitionFilterOption } from "@/components/matches/competition-filter";

/**
 * `/matches`' adapter for the shared competition sheet.
 *
 * The choice goes in the URL rather than in client state, for the same reason
 * the date does: which competition you are reading is a real, shareable,
 * back-button-able location, and the page already re-renders per `?date=` on
 * the server. Filtering client-side would need the whole fixture list to
 * become a client component to gain nothing a query param does not already
 * give — including surviving the link a fan pastes into a group chat.
 *
 * `date` is passed down rather than read from `useSearchParams` so this does
 * not need a Suspense boundary above it, and so the two params can never
 * disagree about which day is being filtered.
 */
export function MatchesCompetitionFilter({
  options,
  selectedId,
  totalCount,
  dateParam,
  liveOnly = false,
}: {
  options: CompetitionFilterOption[];
  selectedId: string | null;
  totalCount: number;
  /** The `?date=` currently on the URL, or null for today. */
  dateParam: string | null;
  /** Whether `?live=1` is currently on. Carried through so choosing a
   * competition narrows what the reader is already looking at rather than
   * silently dropping them back into the full day. */
  liveOnly?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  function handleSelect(id: string | null) {
    const params = new URLSearchParams();
    if (dateParam) params.set("date", dateParam);
    if (id) params.set("competition", id);
    if (liveOnly) params.set("live", "1");
    const query = params.toString();
    startTransition(() => {
      router.push(query ? `/matches?${query}` : "/matches", { scroll: false });
    });
  }

  return (
    <CompetitionFilter
      options={options}
      selectedId={selectedId}
      totalCount={totalCount}
      onSelect={handleSelect}
    />
  );
}
