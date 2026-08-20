import { PageSkeleton } from "@/components/ui/page-skeleton";
import { ListSkeleton, PageHeaderSkeleton } from "@/components/ui/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function PlayersLoading() {
  return (
    <PageSkeleton className="kivo-page" label="Loading Players">
      <PageHeaderSkeleton titleWidth="w-24" />

      {/* Search field, then the position chips and the club chooser. */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full rounded-xl" />
        <div className="flex gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-20 rounded-full" />
          ))}
        </div>
      </div>

      <ListSkeleton rows={8} leading="circle" subtitle />
    </PageSkeleton>
  );
}
