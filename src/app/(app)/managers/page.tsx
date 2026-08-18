import type { Metadata } from "next";
import Link from "next/link";
import { UserRound } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NoDataYet } from "@/components/ui/no-data-yet";
import { EntityListPage } from "@/components/ui/entity-list-page";
import { TeamCrest } from "@/components/ui/team-crest";
import { StaggeredList } from "@/components/ui/staggered-list";
import { staggerDelay } from "@/lib/stagger";

export const metadata: Metadata = { title: "Managers" };

// RECOMMENDATIONS.md item 165: `managers` is synced one row per team (via
// syncTeamSquad, alongside that team's squad), so unlike /teams and
// /players there's no realistic path to needing offset pagination here —
// a generous single-fetch limit, with no "Load more" control, is
// proportionate to how this table actually grows.
const MANAGERS_LIMIT = 500;

export default async function ManagersPage() {
  const supabase = createServerSupabaseClient();

  const { data: managers } = await supabase
    .from("managers")
    .select("id, full_name, nationality, current_team:teams(id, name, short_name, crest_url)")
    .order("full_name", { ascending: true })
    .limit(MANAGERS_LIMIT);

  if (!managers || managers.length === 0) {
    return (
      <NoDataYet
        icon={<UserRound className="h-6 w-6" strokeWidth={1.75} />}
        title="Managers"
        description="No managers synced yet. Managers come in alongside a team's squad sync."
      />
    );
  }

  return (
    <EntityListPage title="Managers" description="Managers synced alongside each team's squad.">
      <StaggeredList
        items={managers}
        keyExtractor={(manager) => manager.id}
        delay={(index) => staggerDelay(index, 0.02)}
        className="flex flex-col gap-2"
        renderItem={(manager) => (
          <Link
            href={`/managers/${manager.id}`}
            className="kivo-glass-sharp flex items-center gap-3 rounded-xl p-3 transition-all hover:-translate-y-0.5 hover:bg-surface-2"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2">
              <UserRound className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-foreground">{manager.full_name}</span>
              <span className="truncate text-xs text-foreground-subtle">
                {[manager.nationality, manager.current_team?.name].filter(Boolean).join(" · ") || "-"}
              </span>
            </div>
            {manager.current_team && (
              <TeamCrest crestUrl={manager.current_team.crest_url} name={manager.current_team.name} size={24} />
            )}
          </Link>
        )}
      />
    </EntityListPage>
  );
}
