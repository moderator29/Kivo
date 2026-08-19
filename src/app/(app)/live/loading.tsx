import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { MatchListSkeleton } from "@/components/matches/match-list";

export default function LiveLoading() {
  return (
    <PageSkeleton className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8" label="Loading live scores">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 px-2">
          <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
          <Skeleton className="h-3.5 w-28" />
        </div>
        <MatchListSkeleton rows={4} />
      </div>

    </PageSkeleton>
  );
}
