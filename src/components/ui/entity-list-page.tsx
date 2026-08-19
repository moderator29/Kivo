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
    /* `.kivo-page`, not a hand-rolled container. The width matched already
       (both 42rem); the vertical rhythm did not — `py-8` is 2rem top and
       bottom where `.kivo-page` is 1.5/2.5rem on a phone and 2/4rem on a
       desktop. So the five browse pages sat on different spacing to every
       other route, and their bottom padding was short of the floating bottom
       bar's clearance. There is a test (src/lib/page-container.test.ts) that
       exists precisely to stop a page and its loading.tsx drifting apart like
       this; nothing was checking the pages against each other. */
    <div className="kivo-page">
      <FadeIn>
        {/* text-2xl, not text-xl. TYPE_STEPS reserves text-xl for a SECTION
            title, so this rendered a page heading at the same weight as a
            panel inside it. The same defect was fixed in PageHeader while the
            primitives landed; it survived here because these five pages do not
            use PageHeader. */}
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        <p className="text-sm text-foreground-muted">{description}</p>
      </FadeIn>
      {children}
    </div>
  );
}
