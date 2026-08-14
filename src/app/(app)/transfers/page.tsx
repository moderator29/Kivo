import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, UserRound } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { FadeIn } from "@/components/ui/fade-in";
import { ComingSoon } from "@/components/ui/coming-soon";
import { TeamCrest } from "@/components/ui/team-crest";
import { TransfersFilters } from "@/components/transfers/transfers-filters";
import { NAV_ITEMS } from "@/lib/navigation";
import type { Database } from "@/lib/supabase/types";

const item = NAV_ITEMS.find((i) => i.id === "transfers")!;

export const metadata: Metadata = { title: item.label };

type TransferType = Database["public"]["Enums"]["transfer_type"];

// Plain, honest labels only — API-Football's /transfers endpoint reports real,
// already-completed moves and nothing else. There is no rumour/reported tier to
// draw from, so no "Confirmed / Rumour / Advanced Talks" taxonomy belongs here
// (that would need a news/journalist source KIVO doesn't have — see AGENTS.md).
const TRANSFER_TYPE_LABEL: Record<TransferType, string> = {
  transfer: "Transfer",
  loan: "Loan",
  free: "Free transfer",
  end_of_loan: "End of loan",
  unknown: "Fee undisclosed",
};

// Matches the exact `transfer_type` enum in supabase/migrations/0006_transfers.sql —
// the filter dropdown's option list has to stay a subset of real values, never a
// fabricated taxonomy of its own.
const TRANSFER_TYPES = Object.keys(TRANSFER_TYPE_LABEL) as TransferType[];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type TeamRef = { id: string; name: string; short_name: string | null; crest_url: string | null };

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

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
      className="group -mx-1.5 flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-xs text-foreground transition hover:bg-white/5 hover:text-kivo-cyan"
    >
      <TeamCrest crestUrl={team.crest_url} name={team.name} size={24} />
      <span className="truncate transition-transform group-hover:translate-x-0.5">{team.short_name ?? team.name}</span>
    </Link>
  );
}

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; club?: string; from?: string; to?: string }>;
}) {
  const { type: typeParam, club: clubParam, from: fromParam, to: toParam } = await searchParams;
  const supabase = createServerSupabaseClient();

  // Never trust the search params directly in a `.or()`/`.eq()` filter string
  // without validating shape first — an allow-listed enum value, a real UUID,
  // a real date, or the filter is simply skipped.
  const validType = typeParam && TRANSFER_TYPES.includes(typeParam as TransferType) ? (typeParam as TransferType) : null;
  const validClub = clubParam && UUID_RE.test(clubParam) ? clubParam : null;
  const validFrom = fromParam && DATE_RE.test(fromParam) ? fromParam : null;
  const validTo = toParam && DATE_RE.test(toParam) ? toParam : null;
  const hasActiveFilters = Boolean(validType || validClub || validFrom || validTo);

  let request = supabase
    .from("transfers")
    .select(
      `id, transfer_date, fee_text, transfer_type,
       player:players(id, full_name, known_as),
       from_team:teams!transfers_from_team_id_fkey(id, name, short_name, crest_url),
       to_team:teams!transfers_to_team_id_fkey(id, name, short_name, crest_url)`,
    )
    .order("transfer_date", { ascending: false });

  // Every filter applied server-side, before `.limit()` — the exact bug
  // already found and fixed once in searchFantasyPlayers (filtering in JS
  // after the limit only ever searches whichever rows happened to land in
  // the first page).
  if (validType) request = request.eq("transfer_type", validType);
  if (validClub) request = request.or(`from_team_id.eq.${validClub},to_team_id.eq.${validClub}`);
  if (validFrom) request = request.gte("transfer_date", validFrom);
  if (validTo) request = request.lte("transfer_date", validTo);

  const [{ data: transfers }, { data: clubRows }] = await Promise.all([
    request.limit(50),
    supabase.from("teams").select("id, name, short_name").order("name", { ascending: true }),
  ]);

  const clubs = (clubRows ?? []).map((c) => ({ id: c.id, name: c.name, shortName: c.short_name }));
  const transferTypeOptions = TRANSFER_TYPES.map((value) => ({ value, label: TRANSFER_TYPE_LABEL[value] }));

  // Nothing synced at all yet (no filters applied, still zero rows) keeps the
  // original full-page "coming soon" state. A filtered query that happens to
  // match nothing gets an inline empty message instead, further down, so the
  // filters themselves stay on screen to adjust.
  if (!hasActiveFilters && (!transfers || transfers.length === 0)) {
    return (
      <ComingSoon icon={<item.icon className="h-9 w-9 text-kivo-white" strokeWidth={1.75} />} image={item.comingSoonImage} title={item.label} description={item.comingSoonDescription ?? "Check back soon."} />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      {/* Transfers-only keyframe: a very subtle idle left-right nudge on the
          from/to arrow, just enough to read as "in motion" without calling
          attention to itself. Scoped here rather than globals.css since it's
          only used on this page; the sitewide prefers-reduced-motion block in
          globals.css (`* { animation-duration: 0.01ms !important }`) already
          clamps it too, same as kivo-aurora on the landing page. */}
      <style>{`
        @keyframes kivo-transfer-arrow-nudge {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(2px); }
          75% { transform: translateX(-2px); }
        }
      `}</style>

      <FadeIn>
        <h1 className="text-xl font-semibold text-foreground">Recorded transfers</h1>
        <p className="text-sm text-foreground-muted">
          Real, already-completed moves for KIVO&apos;s synced players, newest first. No rumours or reports.
        </p>
      </FadeIn>

      <FadeIn delay={0.03}>
        <TransfersFilters
          clubs={clubs}
          transferTypes={transferTypeOptions}
          initialType={validType ?? "All"}
          initialClubId={validClub ?? "All"}
          initialFrom={validFrom ?? ""}
          initialTo={validTo ?? ""}
        />
      </FadeIn>

      {!transfers || transfers.length === 0 ? (
        <FadeIn delay={0.08} className="kivo-glass flex flex-col items-center gap-2 rounded-2xl px-6 py-16 text-center">
          <p className="text-sm text-foreground-muted">No transfers match those filters.</p>
          <p className="max-w-xs text-xs text-foreground-subtle">Try widening the type, club, or date range above.</p>
        </FadeIn>
      ) : (
        <div className="flex flex-col gap-2">
          {transfers.map((transfer, index) => {
            const playerName = transfer.player ? (transfer.player.known_as ?? transfer.player.full_name) : null;

            return (
              <FadeIn key={transfer.id} delay={Math.min(index * 0.03, 0.3)}>
                <div className="kivo-glass flex flex-col gap-3 rounded-2xl p-4 transition hover:bg-white/5">
                  <div className="flex items-center justify-between gap-3">
                    {transfer.player && playerName ? (
                      <Link
                        href={`/players/${transfer.player.id}`}
                        className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground transition hover:text-kivo-cyan"
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
                      {formatDate(transfer.transfer_date)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <TeamLink team={transfer.from_team} />
                    <ArrowLeftRight
                      className="h-3.5 w-3.5 shrink-0 animate-[kivo-transfer-arrow-nudge_3.4s_ease-in-out_infinite] text-foreground-subtle"
                      strokeWidth={1.75}
                    />
                    <TeamLink team={transfer.to_team} />
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-white/5 pt-3">
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
                      {TRANSFER_TYPE_LABEL[transfer.transfer_type]}
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-foreground">{transfer.fee_text ?? "—"}</span>
                  </div>
                </div>
              </FadeIn>
            );
          })}
        </div>
      )}
    </div>
  );
}
