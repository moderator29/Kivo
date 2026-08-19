import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// NewsPage itself renders a static <ComingSoon> with no data fetch, so this
// realistically resolves too fast to ever paint — added anyway for the same
// reason RECOMMENDATIONS.md item 284 flagged every other route without one:
// consistency with the pattern the other 22+ routes already establish, and
// zero cost if it never actually shows.
export default function NewsLoading() {
  return (
    <PageSkeleton className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 px-6 py-24 text-center" label="Loading News">
      <Skeleton className="h-9 w-9 rounded-full" />
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-4 w-56" />
    </PageSkeleton>
  );
}
