import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <Skeleton className="h-5 w-24" />

      <div className="kivo-glass flex flex-col rounded-3xl p-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`flex flex-col gap-2 py-4 ${i > 0 ? "border-t border-white/5" : ""}`}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-40" />
          </div>
        ))}
      </div>
    </div>
  );
}
