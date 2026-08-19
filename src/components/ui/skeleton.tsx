import { cn } from "@/lib/utils";

/**
 * One grey bar. Decorative by definition, so it is hidden from the
 * accessibility tree: a screen reader announcing forty unlabelled boxes is
 * worse than the silence it replaces. The announcement belongs to the
 * container — see `<PageSkeleton>` — which says "loading" once, with a name.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("kivo-skeleton rounded-lg", className)} />;
}
