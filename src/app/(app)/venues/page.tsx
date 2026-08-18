import type { Metadata } from "next";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NoDataYet } from "@/components/ui/no-data-yet";
import { EntityListPage } from "@/components/ui/entity-list-page";
import { StaggeredList } from "@/components/ui/staggered-list";
import { staggerDelay } from "@/lib/stagger";

export const metadata: Metadata = { title: "Venues" };

// RECOMMENDATIONS.md item 166: one venue per fixture's stadium, synced by
// every fixture sync — same "small, no realistic pagination need yet"
// reasoning as /managers.
const VENUES_LIMIT = 500;

export default async function VenuesPage() {
  const supabase = createServerSupabaseClient();

  const { data: venues } = await supabase
    .from("venues")
    .select("id, name, city, country, capacity")
    .order("name", { ascending: true })
    .limit(VENUES_LIMIT);

  if (!venues || venues.length === 0) {
    return (
      <NoDataYet
        icon={<MapPin className="h-6 w-6" strokeWidth={1.75} />}
        title="Venues"
        description="No venues synced yet. Venues come in alongside fixture syncs."
      />
    );
  }

  return (
    <EntityListPage title="Venues" description="Stadiums synced alongside KIVO's fixtures.">
      <StaggeredList
        items={venues}
        keyExtractor={(venue) => venue.id}
        delay={(index) => staggerDelay(index, 0.02)}
        className="flex flex-col gap-2"
        renderItem={(venue) => (
          <Link
            href={`/venues/${venue.id}`}
            className="kivo-glass-sharp flex items-center gap-3 rounded-xl p-3 transition-all hover:-translate-y-0.5 hover:bg-surface-2"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2">
              <MapPin className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-foreground">{venue.name ?? "Unnamed venue"}</span>
              <span className="truncate text-xs text-foreground-subtle">
                {[venue.city, venue.country].filter(Boolean).join(", ") || "-"}
              </span>
            </div>
            {venue.capacity && (
              <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground-subtle">
                {venue.capacity.toLocaleString()}
              </span>
            )}
          </Link>
        )}
      />
    </EntityListPage>
  );
}
