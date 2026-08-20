import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <PageSkeleton label="Loading Settings">
      <Skeleton className="h-5 w-24" />

      <div className="kivo-glass flex flex-col rounded-3xl p-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`flex flex-col gap-2 py-4 ${i > 0 ? "border-t border-hairline-soft" : ""}`}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-40" />
          </div>
        ))}
      </div>
    </PageSkeleton>
  );
}
