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
  /**
   * An optional real next step: "See tomorrow's matches", "Browse competitions".
   * An empty state that offers a way onward stops being a dead end, which is
   * the whole difference between a considered one and an apology.
   */
  action?: ReactNode;
}

/**
 * The empty state for a feature that is fully built but has nothing to show yet.
 *
 * FRONTEND SWEEP 2026-08-19 — this component used to end with a paragraph, on by
 * default, explaining KIVO's data pipeline to whoever hit it: that coverage is
 * built one competition at a time from a verified provider, never scraped, and
 * that an empty section "means KIVO hasn't synced this yet, not that something is
 * broken". Plus a link to /transparency.
 *
 * That paragraph was written in good faith and it is the single clearest example
 * of the problem this sweep exists to fix. A football fan opening a club page does
 * not have a mental model of KIVO's ingestion strategy, has not asked for one, and
 * cannot act on it. Handing them one does not read as honesty — it reads as a
 * product apologising for itself, on a dozen surfaces at once, which is precisely
 * why the app felt broken rather than merely early. Sofascore does not explain its
 * backend on an empty tab; it says "No data" and gets out of the way.
 *
 * So: icon, one title, one football-native line, and an optional way onward.
 * The `/transparency` page still exists and still counts everything for real, for
 * the reader who genuinely wants it — it is now somewhere you go, not something
 * you are handed while looking for a squad list.
 */
export function NoDataYet({ icon, title, description, action }: NoDataYetProps) {
  return (
    <FadeIn className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-hairline-soft bg-surface-1 text-foreground-subtle">
        {icon}
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
        <p className="max-w-[34ch] text-sm leading-relaxed text-foreground-muted">{description}</p>
      </div>
      {action}
    </FadeIn>
  );
}
