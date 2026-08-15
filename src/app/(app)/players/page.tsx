import type { Metadata } from "next";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NoDataYet } from "@/components/ui/no-data-yet";
import { EntityListPage } from "@/components/ui/entity-list-page";
import { PlayersBrowser } from "@/components/players/players-browser";
import { getNavItem } from "@/lib/navigation";

const item = getNavItem("players");

export const metadata: Metadata = { title: item.label };

export default async function PlayersPage() {
  const supabase = createServerSupabaseClient();

  const [{ data: players }, { data: clubs }] = await Promise.all([
    supabase
      .from("players")
      .select("id, full_name, known_as, position, nationality, photo_url, team:teams(name, short_name)")
      .order("full_name", { ascending: true })
      .limit(100),
    supabase.from("teams").select("id, name, short_name").order("name", { ascending: true }),
  ]);

  if (!players || players.length === 0) {
    return (
      <NoDataYet icon={<item.icon className="h-6 w-6" strokeWidth={1.75} />} title={item.label} description={item.comingSoonDescription ?? "Nothing synced yet."} />
    );
  }

  return (
    <EntityListPage title="Players" description="Search KIVO's synced squad players by name, position or club.">
      <PlayersBrowser
        initialPlayers={players.map((player) => ({
          id: player.id,
          name: player.known_as ?? player.full_name,
          position: player.position,
          nationality: player.nationality,
          teamName: player.team?.short_name ?? player.team?.name ?? null,
          photoUrl: player.photo_url,
        }))}
        clubs={(clubs ?? []).map((club) => ({ id: club.id, name: club.name, shortName: club.short_name }))}
      />
    </EntityListPage>
  );
}
