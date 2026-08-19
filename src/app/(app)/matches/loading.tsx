import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { MatchListSkeleton } from "@/components/matches/match-list";

export default function MatchesLoading() {
  return (
    <PageSkeleton className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8" label="Loading Matches">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="flex items-center gap-1.5">
        <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
        <div className="flex flex-1 items-center gap-1.5 overflow-hidden">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-11 shrink-0 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
      </div>

      {/* The same component the page's own competition blocks use, so the
          transition from skeleton to matches is a fill rather than a reflow. */}
      <div className="flex flex-col gap-6">
        {[0, 1].map((group) => (
          <div key={group} className="flex flex-col gap-2">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <Skeleton className="h-[26px] w-[26px] shrink-0 rounded-full" />
                <Skeleton className="h-4 w-32" />
              </div>
              <Skeleton className="h-3 w-16" />
            </div>
            <MatchListSkeleton rows={group === 0 ? 4 : 3} />
          </div>
        ))}
      </div>

    </PageSkeleton>
  );
}
