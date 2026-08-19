import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function SocialLoading() {
  return (
    <PageSkeleton label="Loading the community feed">
      <Skeleton className="h-7 w-32" />
      <div className="kivo-glass flex flex-col gap-3 rounded-2xl p-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="ml-auto h-8 w-20" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="kivo-glass flex flex-col gap-3 rounded-2xl p-4">
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-12" />
            </div>
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-5 w-14" />
        </div>
      ))}
    </PageSkeleton>
  );
}
