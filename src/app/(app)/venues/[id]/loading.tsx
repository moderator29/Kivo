import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { MatchListSkeleton } from "@/components/matches/match-list";

/** The ground's own shape: an identity row on the page rather than in a card,
 * the one number it has, then its matches — which are fixture rows, so they
 * get the fixture skeleton rather than the general one. */
export default function VenueDetailLoading() {
  return (
    <PageSkeleton className="kivo-page" label="Loading this venue">
      <div className="flex items-center gap-3" aria-hidden="true">
        <Skeleton className="h-11 w-11 shrink-0 rounded-2xl" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>

      <div className="kivo-glass rounded-2xl p-5" aria-hidden="true">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="mt-1 h-2.5 w-16" />
      </div>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-28" aria-hidden="true" />
        <MatchListSkeleton rows={5} />
      </div>
    </PageSkeleton>
  );
}
