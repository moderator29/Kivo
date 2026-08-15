import type { Metadata } from "next";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NoDataYet } from "@/components/ui/no-data-yet";
import { EntityListPage } from "@/components/ui/entity-list-page";
import { LeaguesList } from "@/components/leagues/leagues-list";
import { getNavItem } from "@/lib/navigation";
import { LEAGUES_PAGE_SIZE } from "./constants";

const item = getNavItem("leagues");

export const metadata: Metadata = { title: item.label };

export default async function LeaguesPage() {
  const supabase = createServerSupabaseClient();

  // Fetches one extra row beyond the page size so "hasMore" can be read
  // directly off the response, matching the same trick `loadMoreLeagues` uses
  // for every subsequent page.
  const { data } = await supabase
    .from("competitions")
    .select("id, name, country, logo_url, seasons(id, name, is_current)")
    .order("name", { ascending: true })
    .range(0, LEAGUES_PAGE_SIZE);

  const rows = data ?? [];
  const leagues = rows.slice(0, LEAGUES_PAGE_SIZE).map((competition) => {
    const currentSeason = competition.seasons?.find((s) => s.is_current) ?? competition.seasons?.[0] ?? null;
    return {
      id: competition.id,
      name: competition.name,
      country: competition.country,
      logoUrl: competition.logo_url,
      currentSeasonName: currentSeason?.name ?? null,
      hasSeason: currentSeason !== null,
    };
  });
  const hasMore = rows.length > LEAGUES_PAGE_SIZE;

  if (leagues.length === 0) {
    return (
      <NoDataYet icon={<item.icon className="h-6 w-6" strokeWidth={1.75} />} title={item.label} description={item.comingSoonDescription ?? "Nothing synced yet."} />
    );
  }

  return (
    <EntityListPage title="Leagues" description="Competitions synced from today's fixtures.">
      <LeaguesList initialLeagues={leagues} initialHasMore={hasMore} />
    </EntityListPage>
  );
}
