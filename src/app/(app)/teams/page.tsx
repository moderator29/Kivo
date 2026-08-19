import type { Metadata } from "next";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NoDataYet } from "@/components/ui/no-data-yet";
import { LoadFailed } from "@/components/ui/load-failed";
import { readList } from "@/lib/query-result";
import { EntityListPage } from "@/components/ui/entity-list-page";
import { TeamsGrid } from "@/components/teams/teams-grid";
import { getNavItem } from "@/lib/navigation";
import { TEAMS_PAGE_SIZE, TEAM_LIST_SELECT, mapTeamRow } from "./constants";
import { resolveListPage } from "@/lib/params";

const item = getNavItem("teams");

export const metadata: Metadata = { title: item.label };

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const supabase = createServerSupabaseClient();

  // KN-47: how many pages are loaded lives in the URL, not in React state.
  // The list used to accumulate pages client-side, and the `(app)` group is
  // force-dynamic — so opening a club and pressing Back dropped every page
  // past the first. Now Back restores exactly what was on screen, and the URL
  // is shareable.
  const { page: pageParam } = await searchParams;
  const page = resolveListPage(pageParam);
  const loadedCount = page * TEAMS_PAGE_SIZE;

  // Fetches one extra row beyond what's asked for so "hasMore" can be read
  // directly off the response rather than costing a second count query.
  const outcome = readList(
    await supabase
      .from("teams")
      .select(TEAM_LIST_SELECT)
      .order("name", { ascending: true })
      .range(0, loadedCount),
    "teams.list",
  );

  // A failed read is not an empty table, and must never be shown as one: the
  // empty state below tells the user KIVO simply hasn't synced these clubs
  // yet and that nothing is broken, which is exactly wrong when the query
  // fell over. See src/lib/query-result.ts.
  if (outcome.failed) {
    return <LoadFailed title="Teams" icon={<item.icon className="h-6 w-6" strokeWidth={1.75} />} />;
  }

  const rows = outcome.rows;
  const teams = rows.slice(0, loadedCount).map(mapTeamRow);
  const hasMore = rows.length > loadedCount;

  if (teams.length === 0) {
    return (
      <NoDataYet icon={<item.icon className="h-6 w-6" strokeWidth={1.75} />} title={item.label} description={item.emptyDescription ?? "Nothing to show here yet."} />
    );
  }

  return (
    <EntityListPage
      title="Teams"
      description="Every club on KIVO — browse by name, or jump straight to a squad, form guide and fixture list."
    >
      <TeamsGrid teams={teams} hasMore={hasMore} page={page} />
    </EntityListPage>
  );
}
