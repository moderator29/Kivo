import type { Metadata } from "next";
import { UserRound } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NoDataYet } from "@/components/ui/no-data-yet";
import { LoadFailed } from "@/components/ui/load-failed";
import { readList } from "@/lib/query-result";
import { EntityListPage } from "@/components/ui/entity-list-page";
import { ManagersList } from "@/components/managers/managers-list";

export const metadata: Metadata = { title: "Managers" };

// RECOMMENDATIONS.md item 165: `managers` is synced one row per team (via
// syncTeamSquad, alongside that team's squad), so unlike /teams and
// /players there's no realistic path to needing offset pagination here —
// a generous single-fetch limit, with no "Load more" control, is
// proportionate to how this table actually grows.
const MANAGERS_LIMIT = 500;

export default async function ManagersPage() {
  const supabase = createServerSupabaseClient();

  const outcome = readList(
    await supabase
      .from("managers")
      .select("id, full_name, nationality, current_team:teams(id, name, short_name, crest_url)")
      .order("full_name", { ascending: true })
      .limit(MANAGERS_LIMIT),
    "managers.list",
  );

  // A read that failed says nothing about how many managers KIVO has synced,
  // so it must not borrow the empty state's explanation for why there are none.
  if (outcome.failed) {
    return <LoadFailed title="Managers" icon={<UserRound className="h-6 w-6" strokeWidth={1.75} />} />;
  }

  const managers = outcome.rows;

  if (managers.length === 0) {
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
      <ManagersList managers={managers} />
    </EntityListPage>
  );
}
