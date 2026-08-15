"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type TransfersClubOption = { id: string; name: string; shortName: string | null };
export type TransferTypeOption = { value: string; label: string };

/**
 * Type / club / date-range filters for `/transfers`, driven entirely by URL
 * search params (`?type=&club=&from=&to=`) — same idiom as
 * `TeamComparePicker` (local state seeded from server-parsed initial values,
 * pushed onto the URL on change) so the actual filtering stays a real
 * server-side query on the page itself, and no `useSearchParams` /
 * Suspense-boundary wiring is needed here.
 */
export function TransfersFilters({
  clubs,
  transferTypes,
  initialType,
  initialClubId,
  initialFrom,
  initialTo,
}: {
  clubs: TransfersClubOption[];
  transferTypes: TransferTypeOption[];
  initialType: string;
  initialClubId: string;
  initialFrom: string;
  initialTo: string;
}) {
  const router = useRouter();
  const [type, setType] = useState(initialType);
  const [clubId, setClubId] = useState(initialClubId);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);

  function push(next: { type: string; clubId: string; from: string; to: string }) {
    const params = new URLSearchParams();
    if (next.type !== "All") params.set("type", next.type);
    if (next.clubId !== "All") params.set("club", next.clubId);
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
    const qs = params.toString();
    router.push(qs ? `/transfers?${qs}` : "/transfers");
  }

  const hasActiveFilters = type !== "All" || clubId !== "All" || Boolean(from) || Boolean(to);

  function clearFilters() {
    setType("All");
    setClubId("All");
    setFrom("");
    setTo("");
    router.push("/transfers");
  }

  return (
    <div className="kivo-glass-sharp flex flex-col gap-3 rounded-2xl p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="transfer-type" className="text-[11px] font-medium text-foreground-muted">
            Type
          </label>
          <select
            id="transfer-type"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              push({ type: e.target.value, clubId, from, to });
            }}
            className="kivo-glass rounded-lg px-2.5 py-2 text-xs text-foreground outline-none"
          >
            <option value="All">All types</option>
            {transferTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="transfer-club" className="text-[11px] font-medium text-foreground-muted">
            Club
          </label>
          <select
            id="transfer-club"
            value={clubId}
            onChange={(e) => {
              setClubId(e.target.value);
              push({ type, clubId: e.target.value, from, to });
            }}
            className="kivo-glass rounded-lg px-2.5 py-2 text-xs text-foreground outline-none"
          >
            <option value="All">All clubs</option>
            {clubs.map((club) => (
              <option key={club.id} value={club.id}>
                {club.shortName ?? club.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="transfer-from" className="text-[11px] font-medium text-foreground-muted">
            From date
          </label>
          <input
            id="transfer-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              setFrom(e.target.value);
              push({ type, clubId, from: e.target.value, to });
            }}
            className="kivo-glass rounded-lg px-2.5 py-2 text-xs text-foreground outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="transfer-to" className="text-[11px] font-medium text-foreground-muted">
            To date
          </label>
          <input
            id="transfer-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              setTo(e.target.value);
              push({ type, clubId, from, to: e.target.value });
            }}
            className="kivo-glass rounded-lg px-2.5 py-2 text-xs text-foreground outline-none"
          />
        </div>
      </div>

      {hasActiveFilters && (
        <button
          type="button"
          onClick={clearFilters}
          className="self-start text-[11px] font-medium text-foreground-subtle underline decoration-white/20 underline-offset-4 transition hover:text-foreground-muted"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
