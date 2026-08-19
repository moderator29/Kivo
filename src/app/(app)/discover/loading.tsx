import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton } from "@/components/ui/skeletons";

/** Discover's shape: the page header, the search field, then the grid of
 * surfaces. The field is skeletoned because it is the first thing a person
 * reaches for here — a page that draws its grid first and drops a field in
 * afterwards pushes the grid down exactly as the reader starts scanning it. */
export default function DiscoverLoading() {
  return (
    <PageSkeleton className="kivo-page kivo-page--wide" label="Loading Discover">
      <PageHeaderSkeleton titleWidth="w-32" />

      <Skeleton className="h-[52px] w-full rounded-2xl" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="kivo-glass rounded-2xl p-5" aria-hidden="true">
            <div className="mb-4 flex items-center gap-3">
              <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="mt-1.5 h-3.5 w-3/4" />
          </div>
        ))}
      </div>
    </PageSkeleton>
  );
}
