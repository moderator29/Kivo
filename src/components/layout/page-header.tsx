import type { ReactNode } from "react";
import { BackLink, RouteBackLink } from "@/components/ui/back-link";
import { FadeIn } from "@/components/ui/fade-in";
import { cn } from "@/lib/utils";

/**
 * The one page header.
 *
 * Every screen used to open its own way — some with an `h1`, some with an
 * `h1` plus a paragraph, some with neither, at four different sizes and three
 * different top paddings. Read one after another they felt like separate
 * products stacked in a scroller rather than one app, which is exactly the
 * "basic, jammed packed" note this pass is answering. This fixes the opening
 * bar of every page: optional back affordance, title, one line of subtitle,
 * optional trailing action, all on the same rhythm as `.kivo-page`.
 *
 * The back affordance is `<BackLink>` and nothing else. This component used
 * to draw its own — a 12px chevron in a 28px box that pushed to a hardcoded
 * href — which is a second answer to a question docs/BACK_NAVIGATION.md
 * answers once, and a worse one: no 44px target, no "Back to Matches"
 * accessible name, and a fresh push to the parent even when the user tapped in
 * from it a second ago, which throws away the list position they left. Nothing
 * in the app was passing `backHref` yet, so this is the cheapest possible
 * moment to make the doc true.
 */
export function PageHeader({
  title,
  description,
  /**
   * Shows the back control, with the destination worked out from the current
   * route by `backTargetFor()` — which reads its labels from the same nav maps
   * the sidebar renders from, so a renamed section renames every control
   * pointing at it. This is the right answer for every inner page.
   */
  back = false,
  /** For the handful of routes whose real parent the URL does not imply. Pass
   *  both, and pass the destination's own name ("Matches"), not "Back". */
  backHref,
  backLabel,
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  back?: boolean;
  backHref?: string;
  backLabel?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <FadeIn className={cn("flex flex-col gap-1.5", className)}>
      {backHref && backLabel ? (
        <BackLink href={backHref} label={backLabel} tone="inline" />
      ) : back ? (
        <RouteBackLink tone="inline" />
      ) : null}
      <div className="flex items-start justify-between gap-3">
        {/* TYPE_STEPS' page title, verbatim. It was text-xl, which is the
            section-title size — so a page and a panel inside it opened at the
            same weight and the screen had no top of its hierarchy. */}
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {description && <p className="max-w-prose text-sm text-foreground-muted">{description}</p>}
    </FadeIn>
  );
}
