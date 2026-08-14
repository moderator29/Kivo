import type { Metadata } from "next";
import Link from "next/link";
import { UserRound } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { FadeIn } from "@/components/ui/fade-in";
import { ComingSoon } from "@/components/ui/coming-soon";
import { NAV_ITEMS } from "@/lib/navigation";

const item = NAV_ITEMS.find((i) => i.id === "players")!;

export const metadata: Metadata = { title: item.label };

export default async function PlayersPage() {
  const supabase = createServerSupabaseClient();

  const { data: players } = await supabase
    .from("players")
    .select("id, full_name, known_as, position, nationality, current_team:teams(name, crest_url)")
    .order("full_name", { ascending: true })
    .limit(100);

  if (!players || players.length === 0) {
    return (
      <ComingSoon icon={<item.icon className="h-9 w-9 text-kivo-white" strokeWidth={1.75} />} image={item.comingSoonImage} title={item.label} description={item.comingSoonDescription!} />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn>
        <h1 className="text-xl font-semibold text-foreground">Players</h1>
        <p className="text-sm text-foreground-muted">Squad players synced so far.</p>
      </FadeIn>

      <div className="flex flex-col gap-2">
        {players.map((player, index) => (
          <FadeIn key={player.id} delay={Math.min(index * 0.03, 0.3)}>
            <Link
              href={`/players/${player.id}`}
              className="kivo-glass-sharp flex items-center gap-3 rounded-xl p-3 transition-all hover:-translate-y-0.5 hover:bg-white/[0.06]"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/5">
                <UserRound className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />
              </div>
              <div className="flex flex-1 flex-col overflow-hidden">
                <span className="truncate text-sm font-medium text-foreground">{player.known_as ?? player.full_name}</span>
                <span className="truncate text-xs text-foreground-subtle">
                  {[player.position, player.current_team?.name, player.nationality].filter(Boolean).join(" · ")}
                </span>
              </div>
            </Link>
          </FadeIn>
        ))}
      </div>
    </div>
  );
}
