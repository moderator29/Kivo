import { Skeleton } from "@/components/ui/skeleton";

export default function TransparencyLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 lg:px-8">
      <div className="kivo-glass-brand flex items-center gap-4 rounded-2xl p-6">
        <Skeleton className="h-12 w-12 shrink-0 rounded-2xl" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
      </div>
      <div className="kivo-glass rounded-2xl p-6">
        <Skeleton className="mb-4 h-3.5 w-32" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-10" />
            </div>
          ))}
        </div>
      </div>
      <div className="kivo-glass rounded-2xl p-6">
        <Skeleton className="mb-4 h-3.5 w-24" />
        <Skeleton className="h-4 w-56" />
      </div>
    </div>
  );
}
