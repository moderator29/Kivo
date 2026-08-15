import type { ReactNode } from "react";
import { FadeIn } from "@/components/ui/fade-in";

/**
 * Shared page shell for KIVO's browse-a-table pages (/teams, /players,
 * /leagues): a centered column with a `FadeIn`-in title/description header
 * above whatever list/grid the page renders. Each of those pages fetches
 * and shapes its own data very differently (a plain paged select for
 * /teams, a season join for /leagues, a parallel players+clubs fetch with
 * client-side search for /players), so only this header-plus-container
 * scaffold — not the fetch or the empty-state branch — was actually
 * identical among them and worth pulling out.
 */
export function EntityListPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn>
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        <p className="text-sm text-foreground-muted">{description}</p>
      </FadeIn>
      {children}
    </div>
  );
}
