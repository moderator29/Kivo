import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The loading state for the nine pages built on `<SettingsPageShell>`.
 *
 * Same fix as `<ProfilePageSkeleton>`, for the same structural reason: a
 * `loading.tsx` covers its whole subtree, so every settings section was
 * showing `/settings`'s own skeleton — the hub's single tall card of nine
 * navigation rows — before replacing it with a title and a stack of separate
 * control cards. Different shape, different number of blocks, and the page
 * moved when the real thing arrived.
 *
 * `cards` is how many `<SettingsCard>`s the section actually has, so the
 * column is the right height before it fills in rather than after.
 */
export function SettingsPageSkeleton({ cards = 3, label = "Loading" }: { cards?: number; label?: string }) {
  return (
    <PageSkeleton label={label}>
      {/* PageHeader: title text-xl, description text-sm, gap-1.5. */}
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-5 w-72" />
      </div>

      {/* SettingsPageShell wraps its children in `flex flex-col gap-4`. */}
      <div className="flex flex-col gap-4">
        {Array.from({ length: cards }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-2xl" />
        ))}
      </div>
    </PageSkeleton>
  );
}
