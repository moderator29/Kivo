import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";

/**
 * The frame every /home section below the lead slot renders inside.
 *
 * It exists so that the one thing the ordering module produces — a `reason`
 * — always reaches the screen. `selectHomeSections` decides that a section is
 * here and why, and this component is the contract that the "why" is shown
 * rather than dropped. A personalised page that reorders itself without
 * saying why reads as arbitrary; the same page with one line of explanation
 * under each heading reads as attentive.
 */
export function HomeSectionCard({
  icon,
  title,
  reason,
  action,
  children,
}: {
  /** Pre-rendered element, not a component reference — these are rendered
   * from Server Components, and passing a function across the RSC boundary is
   * illegal. Same pattern as ComingSoon and StatTile. */
  icon: ReactNode;
  title: string;
  reason: string;
  action?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <section className="kivo-glass rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            <span className="text-accent">{icon}</span>
            {title}
          </h2>
          <p className="text-[11px] leading-snug text-foreground-subtle">{reason}</p>
        </div>
        {action && (
          <Link
            href={action.href}
            className="kivo-focus flex shrink-0 items-center gap-1 text-xs font-medium text-accent hover:text-accent/80"
          >
            {action.label}
            <ArrowRight className="h-3 w-3" strokeWidth={2} />
          </Link>
        )}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
