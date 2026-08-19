import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The loading state for the pages built on `<ProfilePageShell>`.
 *
 * Every route under `/profile/` used to fall through to `/profile`'s own
 * `loading.tsx`, because a `loading.tsx` covers its whole subtree unless a
 * nested one overrides it. So opening "Change your name" flashed the *profile*
 * skeleton — a cover band, a 92px avatar, a stat rail and a tab bar, at the
 * full page width — and then replaced all of it with a narrow column holding
 * one text field. That is the failure mode worth naming: a skeleton whose shape
 * is wrong is worse than no skeleton, because it makes a promise about the
 * layout and then breaks it.
 *
 * This matches what actually arrives: `.kivo-page--narrow`, the shell's header
 * lines at their real sizes, then whichever body the page has.
 */
export function ProfilePageSkeleton({
  variant = "rows",
  /** Whether the shell's optional description line is rendered by this page. */
  withDescription = false,
  label = "Loading",
}: {
  variant?: "rows" | "grid" | "avatar-grid" | "field";
  withDescription?: boolean;
  label?: string;
}) {
  return (
    <PageSkeleton className="kivo-page kivo-page--narrow" label={label}>
      {/* PageHeader: h1 is text-xl/28px, description text-sm/20px, gap-1.5. */}
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-7 w-40" />
        {withDescription && <Skeleton className="h-5 w-64" />}
      </div>

      {/* The avatar picker's own shape: 18 square tiles, three across on a
          phone and six on a tablet, at the avatar's own corner radius — the
          background picker's 2/3-column grid of 8 would promise the wrong
          layout, which is the exact failure this file's header warns about. */}
      {variant === "avatar-grid" && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {Array.from({ length: 18 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-[28%]" />
          ))}
        </div>
      )}

      {variant === "grid" && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-2xl" />
          ))}
        </div>
      )}

      {variant === "rows" && (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-56 w-full rounded-2xl" />
        </div>
      )}

      {/* One label, one input, one full-width save control — the shape every
          single-field editor under /profile/edit renders. */}
      {variant === "field" && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-4 w-52" />
          <Skeleton className="mt-1 h-11 w-full rounded-xl" />
        </div>
      )}
    </PageSkeleton>
  );
}
