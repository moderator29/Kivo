import type { ReactNode } from "react";
import { FadeIn } from "@/components/ui/fade-in";

interface NoDataYetProps {
  /** Pre-rendered vector icon element, same calling convention as
   * `ComingSoon`'s `icon` prop. No 3D manifest art here on purpose — this
   * state is meant to read as quieter than `ComingSoon`, not as another
   * full-page moment. */
  icon: ReactNode;
  title: string;
  description: string;
}

/**
 * The honest counterpart to `ComingSoon` for a feature that is fully built
 * but whose backing table is currently empty (nothing synced yet). Reuses
 * `ComingSoon`'s general shape — icon, title, description, centered — but
 * drops the "Coming soon" eyebrow, the 3D manifest art, the gradient glow
 * and the glass card, and shrinks the vertical padding, so it reads as a
 * quiet, temporary lull rather than a feature that hasn't shipped.
 * See RECOMMENDATIONS.md item 72.
 */
export function NoDataYet({ icon, title, description }: NoDataYetProps) {
  return (
    <FadeIn className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-foreground-subtle">
        {icon}
      </div>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-base font-semibold text-foreground">{title}</h1>
        <p className="max-w-xs text-sm text-foreground-muted">{description}</p>
      </div>
    </FadeIn>
  );
}
