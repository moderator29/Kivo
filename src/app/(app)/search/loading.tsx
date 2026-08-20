import { PageHeaderSkeleton, ListSkeleton } from "@/components/ui/skeletons";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * /search renders into `.kivo-page`; the group-level fallback renders into the
 * older ad-hoc column, so without this the search field arrived 8px higher than
 * the bar that stood in for it.
 *
 * FRONTEND SWEEP: the second half of that promise was still wrong. This drew a
 * label and six pill-shaped chips, and the page it stands in for has not
 * rendered chips since "Browse everything" became a `<ListSurface>` — so the
 * skeleton said "a row of tags is coming" and a five-row list arrived. It is
 * `<ListSkeleton>` now, reading its geometry from the same primitive the real
 * list does, which is the only version of this that cannot drift again.
 *
 * Recents and popular clubs are deliberately not skeletoned: recents live in
 * localStorage and popular clubs may be empty, so promising either would be
 * promising a block that often never arrives.
 */
export default function SearchLoading() {
  return (
    <PageSkeleton label="Loading Search">
      <PageHeaderSkeleton titleWidth="w-28" />

      <div className="flex flex-col gap-6">
        {/* The field itself: kivo-glass, px-4 py-3, a 44px box. */}
        <Skeleton className="h-[50px] w-full rounded-2xl" />
        <div className="flex flex-col gap-2">
          <Skeleton className="mx-1 h-3 w-32" />
          <ListSkeleton rows={5} leading="square" subtitle={false} />
        </div>
      </div>
    </PageSkeleton>
  );
}
