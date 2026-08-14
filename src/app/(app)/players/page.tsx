import type { Metadata } from "next";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { FadeIn } from "@/components/ui/fade-in";
import { ComingSoon } from "@/components/ui/coming-soon";
import { PlayersBrowser } from "@/components/players/players-browser";
import { NAV_ITEMS } from "@/lib/navigation";

const item = NAV_ITEMS.find((i) => i.id === "players")!;

export const metadata: Metadata = { title: item.label };

export default async function PlayersPage() {
  const supabase = createServerSupabaseClient();

  const [{ data: players }, { data: clubs }] = await Promise.all([
    supabase
      .from("players")
      .select("id, full_name, known_as, position, nationality, team:teams(name, short_name)")
      .order("full_name", { ascending: true })
      .limit(100),
    supabase.from("teams").select("id, name, short_name").order("name", { ascending: true }),
  ]);

  if (!players || players.length === 0) {
    return (
      <ComingSoon icon={<item.icon className="h-9 w-9 text-kivo-white" strokeWidth={1.75} />} image={item.comingSoonImage} title={item.label} description={item.comingSoonDescription ?? "Check back soon."} />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn>
        <h1 className="text-xl font-semibold text-foreground">Players</h1>
        <p className="text-sm text-foreground-muted">Search KIVO&apos;s synced squad players by name, position or club.</p>
      </FadeIn>

      <PlayersBrowser
        initialPlayers={players.map((player) => ({
          id: player.id,
          name: player.known_as ?? player.full_name,
          position: player.position,
          nationality: player.nationality,
          teamName: player.team?.short_name ?? player.team?.name ?? null,
        }))}
        clubs={(clubs ?? []).map((club) => ({ id: club.id, name: club.name, shortName: club.short_name }))}
      />
    </div>
  );
}
