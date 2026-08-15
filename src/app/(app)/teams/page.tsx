import type { Metadata } from "next";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NoDataYet } from "@/components/ui/no-data-yet";
import { EntityListPage } from "@/components/ui/entity-list-page";
import { TeamsGrid } from "@/components/teams/teams-grid";
import { getNavItem } from "@/lib/navigation";
import { TEAMS_PAGE_SIZE } from "./constants";

const item = getNavItem("teams");

export const metadata: Metadata = { title: item.label };

export default async function TeamsPage() {
  const supabase = createServerSupabaseClient();

  // Fetches one extra row beyond the page size so "hasMore" can be read
  // directly off the response, matching the same trick `loadMoreTeams` uses
  // for every subsequent page.
  const { data } = await supabase
    .from("teams")
    .select("id, name, short_name, country, crest_url")
    .order("name", { ascending: true })
    .range(0, TEAMS_PAGE_SIZE);

  const rows = data ?? [];
  const teams = rows.slice(0, TEAMS_PAGE_SIZE).map((t) => ({
    id: t.id,
    name: t.name,
    shortName: t.short_name,
    country: t.country,
    crestUrl: t.crest_url,
  }));
  const hasMore = rows.length > TEAMS_PAGE_SIZE;

  if (teams.length === 0) {
    return (
      <NoDataYet icon={<item.icon className="h-6 w-6" strokeWidth={1.75} />} title={item.label} description={item.comingSoonDescription ?? "Nothing synced yet."} />
    );
  }

  return (
    <EntityListPage title="Teams" description="Clubs synced from today's fixtures.">
      <TeamsGrid initialTeams={teams} initialHasMore={hasMore} />
    </EntityListPage>
  );
}
