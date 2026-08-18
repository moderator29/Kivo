import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
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
 * `backHref` is a real `<Link>`, never `router.back()` — a page reached from a
 * notification, a shared link or a bookmark has no history to go back to, and
 * a control that does nothing on first arrival is worse than no control.
 */
export function PageHeader({
  title,
  description,
  backHref,
  backLabel,
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  backHref?: string;
  backLabel?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <FadeIn className={cn("flex flex-col gap-1.5", className)}>
      {backHref && (
        <Link
          href={backHref}
          className="kivo-focus -ml-1.5 flex w-fit items-center gap-1 rounded-lg py-1 pl-1 pr-2 text-xs font-medium text-foreground-subtle transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
          {backLabel ?? "Back"}
        </Link>
      )}
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {description && <p className="max-w-prose text-sm text-foreground-muted">{description}</p>}
    </FadeIn>
  );
}
