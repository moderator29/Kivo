import type { Metadata } from "next";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { FadeIn } from "@/components/ui/fade-in";
import { ComingSoon } from "@/components/ui/coming-soon";
import { TeamsGrid } from "@/components/teams/teams-grid";
import { NAV_ITEMS } from "@/lib/navigation";
import { TEAMS_PAGE_SIZE } from "./constants";

const item = NAV_ITEMS.find((i) => i.id === "teams")!;

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
      <ComingSoon icon={<item.icon className="h-9 w-9 text-kivo-white" strokeWidth={1.75} />} image={item.comingSoonImage} title={item.label} description={item.comingSoonDescription ?? "Check back soon."} />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn>
        <h1 className="text-xl font-semibold text-foreground">Teams</h1>
        <p className="text-sm text-foreground-muted">Clubs synced from today&apos;s fixtures.</p>
      </FadeIn>

      <TeamsGrid initialTeams={teams} initialHasMore={hasMore} />
    </div>
  );
}
