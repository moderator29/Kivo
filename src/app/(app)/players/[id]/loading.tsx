import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The player page's own geometry, drawn empty — identity block with its
 * four-figure headline strip, the tab rail, then the first section. Same
 * radii and same rhythm as `page.tsx`, so nothing moves when the real page
 * arrives.
 */
export default function PlayerDetailLoading() {
  return (
    <PageSkeleton className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 lg:px-8" label="Loading this player">
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
          {["w-16", "w-24", "w-12"].map((width, i) => (
            <Skeleton key={i} className={`h-7 rounded-full ${width}`} />
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2 border-t border-hairline-soft pt-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      </div>

      <div className="-mx-4 flex gap-4 border-b border-hairline px-4 pb-3 lg:mx-0 lg:px-0">
        {["w-16", "w-16", "w-11", "w-16"].map((width, i) => (
          <Skeleton key={i} className={`h-4 shrink-0 ${width}`} />
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-28 w-full rounded-2xl" />
      </div>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </div>
    </PageSkeleton>
  );
}
