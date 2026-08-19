import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// /search renders into `.kivo-page`; the group-level fallback renders into the
// older ad-hoc column, so without this the search field arrived 8px higher than
// the bar that stood in for it.
export default function SearchLoading() {
  return (
    <PageSkeleton label="Loading Search">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-5 w-72" />
      </div>

      <div className="flex flex-col gap-6">
        {/* The field itself: kivo-glass, px-4 py-3, a 44px box. */}
        <Skeleton className="h-[50px] w-full rounded-2xl" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-3.5 w-32" />
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-24 rounded-full" />
            ))}
          </div>
        </div>
      </div>
    </PageSkeleton>
  );
}
