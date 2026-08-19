import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The club page's own geometry, drawn empty.
 *
 * Same container widths, same card radii, same tab rail height as
 * `page.tsx` — a skeleton whose shape differs from what replaces it produces a
 * reflow at the exact moment the reader starts reading, which is most of what
 * makes loading feel unpolished.
 */
export default function TeamDetailLoading() {
  return (
    <PageSkeleton className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 lg:px-8" label="Loading this club">
      {/* Identity block */}
      <div className="kivo-glass-brand flex flex-col gap-4 rounded-2xl p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <Skeleton className="h-14 w-14 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-36" />
          </div>
          <Skeleton className="h-9 w-20 shrink-0 rounded-xl" />
        </div>
        <div className="flex items-center gap-5 border-t border-hairline-soft pt-4">
          <Skeleton className="h-8 w-24" />
          <div className="flex gap-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-7 rounded-full" />
            ))}
          </div>
        </div>
      </div>

      {/* Tab rail */}
      <div className="-mx-4 flex gap-4 border-b border-hairline px-4 pb-3 lg:mx-0 lg:px-0">
        {["w-16", "w-12", "w-16", "w-14", "w-12"].map((width, i) => (
          <Skeleton key={i} className={`h-4 shrink-0 ${width}`} />
        ))}
      </div>

      {/* Next match */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>

      {/* A list surface of results */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-28" />
        <div className="kivo-glass flex flex-col divide-y divide-hairline-soft overflow-hidden rounded-2xl">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5">
              <Skeleton className="h-7 w-7 shrink-0 rounded" />
              <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-2.5 w-16" />
              </div>
              <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </PageSkeleton>
  );
}
