import { PageSkeleton } from "@/components/ui/page-skeleton";
import { ListSkeleton, PageHeaderSkeleton } from "@/components/ui/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function ManagersLoading() {
  return (
    <PageSkeleton className="kivo-page" label="Loading Managers">
      <PageHeaderSkeleton titleWidth="w-28" />
      <Skeleton className="h-10 w-full rounded-xl" />
      <ListSkeleton rows={8} leading="circle" subtitle trailing />
    </PageSkeleton>
  );
}
