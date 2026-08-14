import type { Metadata } from "next";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { FadeIn } from "@/components/ui/fade-in";
import { ComingSoon } from "@/components/ui/coming-soon";
import { LeaguesList } from "@/components/leagues/leagues-list";
import { NAV_ITEMS } from "@/lib/navigation";
import { LEAGUES_PAGE_SIZE } from "./constants";

const item = NAV_ITEMS.find((i) => i.id === "leagues")!;

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
      <ComingSoon icon={<item.icon className="h-9 w-9 text-kivo-white" strokeWidth={1.75} />} image={item.comingSoonImage} title={item.label} description={item.comingSoonDescription ?? "Check back soon."} />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn>
        <h1 className="text-xl font-semibold text-foreground">Leagues</h1>
        <p className="text-sm text-foreground-muted">Competitions synced from today&apos;s fixtures.</p>
      </FadeIn>

      <LeaguesList initialLeagues={leagues} initialHasMore={hasMore} />
    </div>
  );
}
