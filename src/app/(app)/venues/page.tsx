import type { Metadata } from "next";
import { MapPin } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NoDataYet } from "@/components/ui/no-data-yet";
import { LoadFailed } from "@/components/ui/load-failed";
import { readList } from "@/lib/query-result";
import { EntityListPage } from "@/components/ui/entity-list-page";
import { VenuesList } from "@/components/venues/venues-list";

export const metadata: Metadata = { title: "Venues" };

// RECOMMENDATIONS.md item 166: one venue per fixture's stadium, synced by
// every fixture sync — same "small, no realistic pagination need yet"
// reasoning as /managers.
const VENUES_LIMIT = 500;

export default async function VenuesPage() {
  const supabase = createServerSupabaseClient();

  const outcome = readList(
    await supabase
      .from("venues")
      .select("id, name, city, country, capacity")
      .order("name", { ascending: true })
      .limit(VENUES_LIMIT),
    "venues.list",
  );

  // Told apart deliberately: the empty state below explains KIVO's sync
  // schedule, which is a false explanation for a read that failed.
  if (outcome.failed) {
    return <LoadFailed title="Venues" icon={<MapPin className="h-6 w-6" strokeWidth={1.75} />} />;
  }

  const venues = outcome.rows;

  if (venues.length === 0) {
    return (
      <NoDataYet
        icon={<MapPin className="h-6 w-6" strokeWidth={1.75} />}
        title="Venues"
        description="No venues to show yet. Check back soon."
      />
    );
  }

  return (
    <EntityListPage title="Venues" description="The grounds the football is played at.">
      <VenuesList venues={venues} />
    </EntityListPage>
  );
}
