import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";

interface NoDataYetProps {
  /** Pre-rendered vector icon element, same calling convention as
   * `ComingSoon`'s `icon` prop. No 3D manifest art here on purpose — this
   * state is meant to read as quieter than `ComingSoon`, not as another
   * full-page moment. */
  icon: ReactNode;
  title: string;
  description: string;
  /**
   * KIVO_NEXT_GEN KN-115. On by default, and the default is the point.
   *
   * Set false only for an empty state whose emptiness is genuinely about the
   * *viewer* rather than about KIVO's coverage — "you haven't saved anything
   * yet" is not the data pipeline's fault and explaining the pipeline there
   * would be a non-sequitur.
   */
  explainCoverage?: boolean;
}

/**
 * The honest counterpart to `ComingSoon` for a feature that is fully built
 * but whose backing table is currently empty (nothing synced yet). Reuses
 * `ComingSoon`'s general shape — icon, title, description, centered — but
 * drops the "Coming soon" eyebrow, the 3D manifest art, the gradient glow
 * and the glass card, and shrinks the vertical padding, so it reads as a
 * quiet, temporary lull rather than a feature that hasn't shipped.
 * See RECOMMENDATIONS.md item 72.
 *
 * KIVO_NEXT_GEN KN-115: it now also says *why*, in one line, everywhere.
 *
 * A dozen surfaces each independently said "nothing synced yet" and stopped
 * there. Individually each was honest; together they read as a product that is
 * broken, because nowhere did anything explain that KIVO's coverage is
 * deliberately built one competition at a time rather than scraped wholesale.
 * That is a real product position — it is the reason KIVO can promise it never
 * invents football data — and stating it turns a wall of apparent emptiness
 * into a stated intent.
 *
 * Deliberately part of this shared component rather than a first-run banner or
 * a dismissible tip: it appears exactly where the question occurs to someone,
 * needs no stored dismissal state, and disappears on its own the moment there
 * is data. `/transparency` is the page that then shows exactly what KIVO does
 * have, counted for real — so this is a route into a fact, not reassurance.
 */
export function NoDataYet({ icon, title, description, explainCoverage = true }: NoDataYetProps) {
  return (
    <FadeIn className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-1 text-foreground-subtle">
        {icon}
      </div>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-base font-semibold text-foreground">{title}</h1>
        <p className="max-w-xs text-sm text-foreground-muted">{description}</p>
      </div>
      {explainCoverage && (
        <div className="flex max-w-sm flex-col items-center gap-2">
          <p className="text-xs leading-relaxed text-foreground-subtle">
            KIVO builds its football data one competition at a time, from a verified provider — never scraped, never
            filled in with estimates. Coverage starts empty and grows as competitions are switched on, so an empty
            section here means KIVO hasn&apos;t synced this yet, not that something is broken.
          </p>
          <Link
            href="/transparency"
            className="inline-flex items-center gap-1 rounded text-xs font-medium text-accent transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            See exactly what KIVO has
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
          </Link>
        </div>
      )}
    </FadeIn>
  );
}
