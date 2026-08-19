import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function AiCopilotLoading() {
  return (
    <PageSkeleton className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-8 lg:px-8" label="Loading AI Copilot">
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-8 shrink-0 rounded-xl" />
        <Skeleton className="h-5 w-28" />
      </div>

      <div className="flex flex-1 flex-col gap-4 pt-4">
        <Skeleton className="h-16 w-2/3 self-start rounded-2xl" />
        <Skeleton className="h-10 w-1/2 self-end rounded-2xl" />
        <Skeleton className="h-24 w-3/4 self-start rounded-2xl" />
      </div>

      <Skeleton className="h-12 w-full shrink-0 rounded-2xl" />
    </PageSkeleton>
  );
}
