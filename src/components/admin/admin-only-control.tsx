import type { ReactNode } from "react";
import { Wrench } from "lucide-react";

/**
 * The visual shell every staff-only control rendered on a PUBLIC surface wears.
 *
 * FRONTEND SWEEP 2026-08-19. This exists because of a specific, diagnosable
 * failure, and naming the failure is the point:
 *
 * KIVO's admin controls on public pages were already correctly gated — every one
 * of them sat behind `canManageFootballData(profile?.role)` and no ordinary fan
 * could ever reach them. The gating was never the bug. The bug was that a
 * super_admin reviewing his own product could not tell, at a glance, which parts
 * of the screen the public actually sees. "Sync match details", a quota checkbox
 * and a squad-dependency footnote rendered in exactly the same visual language as
 * the match itself, so they read as product, and they were reviewed as product,
 * and they shaped an opinion of the product that the product did not deserve.
 *
 * So this is not a security control — the role check upstream is, and it stays.
 * This is a REVIEW control. Dashed amber, a wrench, and the word "Staff" borrow
 * the vocabulary `PreviewMarker` already established for "this is not what a
 * visitor sees", so the two admin-visible-only affordances in the app now speak
 * the same language. A screenshot cropped to just this control is still obviously
 * staff tooling.
 *
 * Rule for adding one: if a control is gated on a role, and it renders anywhere
 * under `src/app/(app)` rather than `src/app/admin`, it goes in this shell. If it
 * does not need to be on the public page at all, it belongs in /admin instead —
 * this shell is for the ones that genuinely earn their place next to the data
 * they act on.
 */
export function AdminOnlyControl({
  /** What this control is for, in staff language. Kept short — it is a label. */
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-xl border border-dashed border-amber-400/70 bg-amber-400/[0.06] p-3 ${className}`}
    >
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-400">
        <Wrench className="h-3 w-3 shrink-0" strokeWidth={2} />
        Staff · {label}
        <span className="sr-only"> (admin-only control — not visible to visitors)</span>
      </p>
      {children}
    </div>
  );
}
