import { Skeleton } from "@/components/ui/skeleton";

export default function ProfileLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <div className="kivo-glass flex items-center gap-4 rounded-3xl p-6">
        <Skeleton className="h-16 w-16 shrink-0 rounded-full" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-4.5 w-32" />
          <Skeleton className="h-3.5 w-24" />
        </div>
        <Skeleton className="h-8 w-24 shrink-0 rounded-xl" />
      </div>

      <Skeleton className="h-24 w-full rounded-3xl" />

      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>

      <Skeleton className="h-32 w-full rounded-3xl" />
    </div>
  );
}
