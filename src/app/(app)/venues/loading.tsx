import { PageSkeleton } from "@/components/ui/page-skeleton";
import { ListSkeleton, PageHeaderSkeleton } from "@/components/ui/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function VenuesLoading() {
  return (
    <PageSkeleton className="kivo-page" label="Loading Venues">
      <PageHeaderSkeleton titleWidth="w-24" />
      {/* The search field the list is filtered with. */}
      <Skeleton className="h-10 w-full rounded-xl" />
      <ListSkeleton rows={8} leading="circle" subtitle trailing />
    </PageSkeleton>
  );
}
