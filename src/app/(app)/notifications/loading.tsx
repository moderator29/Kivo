import { Skeleton } from "@/components/ui/skeleton";

export default function NotificationsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8 lg:px-8">
      <Skeleton className="h-6 w-32" />

      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="kivo-glass flex items-center gap-3 rounded-2xl p-3">
            <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
