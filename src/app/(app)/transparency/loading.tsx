import { PageSkeleton } from "@/components/ui/page-skeleton";
import { StatGridSkeleton } from "@/components/ui/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function TransparencyLoading() {
  return (
    <PageSkeleton className="kivo-page" label="Loading What KIVO knows">
      <div className="kivo-glass-brand flex items-center gap-4 rounded-3xl p-6">
        <Skeleton className="h-12 w-12 shrink-0 rounded-2xl" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
      </div>

      {/* The section titles are static, so they arrive as themselves rather
          than as grey bars that flicker into words on every load. */}
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">On record</h2>
        <StatGridSkeleton columns={2} stats={8} />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Freshness</h2>
        <div className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-4 w-full" />
        </div>
      </div>
    </PageSkeleton>
  );
}
