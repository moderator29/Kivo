import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function MyPredictionsLoading() {
  return (
    <PageSkeleton className="kivo-page" label="Loading your predictions">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-3.5 w-56" />
      </div>

      <div className="kivo-glass-brand grid grid-cols-3 gap-2 rounded-2xl p-5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <Skeleton className="h-6 w-10" />
            <Skeleton className="h-3 w-14" />
          </div>
        ))}
      </div>

      {/* One surface, divided rows, three lines deep — the same geometry the
          prediction list itself now has. It used to draw five separate glass
          cards, which is what the list used to be; a skeleton that does not
          match its content turns every load into a reflow at the exact moment
          the reader starts reading. */}
      <div className="kivo-glass overflow-hidden rounded-2xl" aria-hidden="true">
        <div className="flex flex-col divide-y divide-hairline-soft">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-3 px-4 py-3.5">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-16 rounded-full" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-1 items-center gap-2">
                  <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
                  <Skeleton className="h-3.5 w-24" />
                </div>
                <Skeleton className="h-3 w-8 shrink-0" />
                <div className="flex flex-1 items-center justify-end gap-2">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-hairline-soft pt-3">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-4 w-16 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </PageSkeleton>
  );
}
