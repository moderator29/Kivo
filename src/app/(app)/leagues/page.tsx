import type { Metadata } from "next";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NoDataYet } from "@/components/ui/no-data-yet";
import { EntityListPage } from "@/components/ui/entity-list-page";
import { LeaguesList } from "@/components/leagues/leagues-list";
import { getNavItem } from "@/lib/navigation";
import { LEAGUES_PAGE_SIZE, LEAGUE_LIST_SELECT, mapCompetitionRow } from "./constants";
import { resolveListPage } from "@/lib/params";

const item = getNavItem("leagues");

export const metadata: Metadata = { title: item.label };

export default async function LeaguesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const supabase = createServerSupabaseClient();

  // KN-47: pages loaded live in the URL, so Back from a competition page
  // returns to the same list rather than to page one. See resolveListPage.
  const { page: pageParam } = await searchParams;
  const page = resolveListPage(pageParam);
  const loadedCount = page * LEAGUES_PAGE_SIZE;

  // One extra row beyond what's asked for, so "hasMore" reads straight off the
  // response instead of costing a second count query.
  const { data } = await supabase
    .from("competitions")
    .select(LEAGUE_LIST_SELECT)
    .order("name", { ascending: true })
    .range(0, loadedCount);

  const rows = data ?? [];
  const leagues = rows.slice(0, loadedCount).map(mapCompetitionRow);
  const hasMore = rows.length > loadedCount;

  if (leagues.length === 0) {
    return (
      <NoDataYet icon={<item.icon className="h-6 w-6" strokeWidth={1.75} />} title={item.label} description={item.comingSoonDescription ?? "Nothing synced yet."} />
    );
  }

  return (
    <EntityListPage title="Leagues" description="Competitions synced from today's fixtures.">
      <LeaguesList leagues={leagues} hasMore={hasMore} page={page} />
    </EntityListPage>
  );
}
