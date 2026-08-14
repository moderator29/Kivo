import Image from "next/image";
import Link from "next/link";
import { ArrowLeftRight, Shield, UserRound } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { FadeIn } from "@/components/ui/fade-in";
import { ComingSoon } from "@/components/ui/coming-soon";
import { NAV_ITEMS } from "@/lib/navigation";
import type { Database } from "@/lib/supabase/types";

const item = NAV_ITEMS.find((i) => i.id === "transfers")!;

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

type TeamRef = { id: string; name: string; short_name: string | null; crest_url: string | null };

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function TeamCrest({ crestUrl, name, size = 24 }: { crestUrl: string | null; name: string | null; size?: number }) {
  if (crestUrl) {
    return (
      <Image
        src={crestUrl}
        alt={name ?? ""}
        width={size}
        height={size}
        className="shrink-0 object-contain"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-white/5"
      style={{ width: size, height: size }}
    >
      <Shield className="h-1/2 w-1/2 text-foreground-subtle" strokeWidth={1.75} />
    </div>
  );
}

function TeamLink({ team }: { team: TeamRef | null }) {
  if (!team) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2 text-xs text-foreground-subtle">
        <TeamCrest crestUrl={null} name={null} />
        Club not synced
      </span>
    );
  }
  return (
    <Link
      href={`/teams/${team.id}`}
      className="flex min-w-0 flex-1 items-center gap-2 text-xs text-foreground transition hover:text-kivo-cyan"
    >
      <TeamCrest crestUrl={team.crest_url} name={team.name} />
      <span className="truncate">{team.short_name ?? team.name}</span>
    </Link>
  );
}

export default async function TransfersPage() {
  const supabase = createServerSupabaseClient();

  const { data: transfers } = await supabase
    .from("transfers")
    .select(
      `id, transfer_date, fee_text, transfer_type,
       player:players(id, full_name, known_as),
       from_team:teams!transfers_from_team_id_fkey(id, name, short_name, crest_url),
       to_team:teams!transfers_to_team_id_fkey(id, name, short_name, crest_url)`,
    )
    .order("transfer_date", { ascending: false })
    .limit(50);

  if (!transfers || transfers.length === 0) {
    return (
      <ComingSoon icon={item.icon} image={item.comingSoonImage} title={item.label} description={item.comingSoonDescription!} />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn>
        <h1 className="text-xl font-semibold text-foreground">Recorded transfers</h1>
        <p className="text-sm text-foreground-muted">
          Real, already-completed moves for KIVO&apos;s synced players, newest first. No rumours or reports.
        </p>
      </FadeIn>

      <div className="flex flex-col gap-2">
        {transfers.map((transfer, index) => {
          const playerName = transfer.player ? (transfer.player.known_as ?? transfer.player.full_name) : null;

          return (
            <FadeIn key={transfer.id} delay={Math.min(index * 0.02, 0.3)}>
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
                  <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
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
    </div>
  );
}
