import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { ListSkeleton, SectionHeadingSkeleton, SectionTabsSkeleton } from "@/components/ui/skeletons";

/**
 * The player page's own geometry, drawn empty: identity block with its
 * four-figure headline strip, the tab rail, then the first two sections.
 *
 * Shared pieces come from the skeleton family (`docs/UI_PRIMITIVES.md` §3);
 * the identity block is drawn here because it is this page's own shape. The
 * headline strip is four cells, matching `<StatGrid inset columns={4}>` in the
 * real header — a skeleton that promises a different column count is a reflow
 * with extra steps.
 */
export default function PlayerDetailLoading() {
  return (
    <PageSkeleton className="kivo-page" label="Loading this player">
      <div className="kivo-glass-brand flex flex-col gap-4 rounded-2xl p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <Skeleton className="h-16 w-16 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-9 w-20 shrink-0 rounded-xl" />
        </div>
        <div className="flex gap-2">
          {["w-16", "w-24", "w-16"].map((width, i) => (
            <Skeleton key={i} className={`h-7 rounded-full ${width}`} />
          ))}
        </div>
        <div className="grid grid-cols-4 gap-x-3 gap-y-5 border-t border-hairline-soft pt-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-5 w-10" />
              <Skeleton className="h-2.5 w-12" />
            </div>
          ))}
        </div>
      </div>

      <SectionTabsSkeleton tabs={4} />

      <div className="flex flex-col gap-3">
        <SectionHeadingSkeleton />
        <Skeleton className="h-28 w-full rounded-2xl" />
      </div>

      <div className="flex flex-col gap-3">
        <SectionHeadingSkeleton />
        {/* The match log's rows: a crest, two lines, and a rating on the
            right. */}
        <ListSkeleton rows={3} leading="square" subtitle trailing />
      </div>
    </PageSkeleton>
  );
}
