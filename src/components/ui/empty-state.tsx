import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/**
 * Nothing here — said in football, not in engineering.
 *
 * This component used to be `<NoDataYet>` (still exported from
 * no-data-yet.tsx, which now re-exports this one) and it used to end with a
 * paragraph explaining KIVO's ingestion strategy to whoever hit it: coverage
 * built one competition at a time, never scraped, an empty section means
 * nothing is broken. That paragraph was written in good faith and it is the
 * clearest single example of the problem the founder was reacting to. A fan
 * opening a club page has no mental model of KIVO's backend, did not ask for
 * one, and cannot act on one. Handing them it does not read as honesty; it
 * reads as a product apologising for itself.
 *
 * ## The rule for the words
 *
 * Say what the fan can expect or act on. Never say what failed, and never name
 * anything internal — no sync, no provider, no quota, no API, no ids, no
 * "loading". Those words belong in Admin and nowhere else.
 *
 *   Good: "Line-ups are published about an hour before kick-off."
 *   Good: "No goals yet."
 *   Good: "This club hasn't played a competitive match this season."
 *   Bad:  "No data available."          (says nothing)
 *   Bad:  "Lineups not yet synced."     (internal, and blames the machinery)
 *   Bad:  "Failed to load lineups."     (that is an error, not an empty state —
 *                                        use <LoadFailed> or <InlineError>)
 *
 * An empty state and a failed read are different facts and the distinction
 * matters: `<LoadFailed>` (load-failed.tsx) is for "we could not find out",
 * this is for "there is genuinely nothing yet".
 */
export function EmptyState({
  /**
   * A component reference, not an element — this is a Server Component, so a
   * Server Component page can pass a lucide icon straight in. Drawn through
   * `<Icon>` so its stroke weight comes off the scale rather than from the
   * call site.
   */
  icon,
  title,
  /** One line. Football language. See the rule above. */
  description,
  /**
   * A real next step: "See tomorrow's matches", "Browse competitions". An
   * empty state that offers a way onward stops being a dead end, which is the
   * whole difference between a considered one and an apology.
   */
  action,
  /**
   * `page` fills the screen, for when the empty thing IS the page. `section`
   * is a quiet inline block for one empty region beside content that loaded —
   * an empty tab panel, a section with nothing in it yet. Using `page` for a
   * section leaves a hundred vertical pixels of nothing in the middle of a
   * working screen.
   */
  tone = "page",
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  tone?: "page" | "section";
  className?: string;
}) {
  return (
    <EmptyStateFrame
      icon={<Icon icon={icon} size={tone === "page" ? "lg" : "md"} aria-hidden="true" />}
      title={title}
      description={description}
      action={action}
      tone={tone}
      className={className}
    />
  );
}

/**
 * The same thing, taking an already-rendered icon element.
 *
 * It exists for one reason: `<NoDataYet>` (no-data-yet.tsx) has fourteen call
 * sites across pages this agent does not own, and its icon prop is a
 * `ReactNode`. Rewriting those fourteen files to change an icon's calling
 * convention would be churn in someone else's work to no visible benefit, so
 * `NoDataYet` re-renders through this frame instead and the two states stay
 * pixel-identical by construction rather than by luck.
 *
 * New code uses `<EmptyState>`. This is the seam, not the entry point.
 */
export function EmptyStateFrame({
  icon,
  title,
  description,
  action,
  tone = "page",
  className,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  tone?: "page" | "section";
  className?: string;
}) {
  return (
    <FadeIn
      className={cn(
        "flex flex-col items-center text-center",
        tone === "page" ? "flex-1 justify-center gap-4 px-6 py-16" : "gap-3 px-4 py-10",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-2xl border border-hairline-soft bg-surface-1 text-foreground-subtle",
          tone === "page" ? "h-11 w-11" : "h-9 w-9",
        )}
      >
        {icon}
      </div>
      <div className="flex flex-col gap-1.5">
        <p className={cn("font-semibold tracking-tight text-foreground", tone === "page" ? "text-base" : "text-sm")}>
          {title}
        </p>
        <p className="max-w-[34ch] text-sm leading-relaxed text-foreground-muted">{description}</p>
      </div>
      {action}
    </FadeIn>
  );
}

/**
 * One line saying a part of the screen did not load, inside the space that
 * part would have occupied.
 *
 * `<LoadFailed>` is the full treatment: an icon, a paragraph, a retry that
 * re-runs the server render, and a support route after a second failure. It is
 * right when the failed read *is* the page. It is much too big for one panel
 * failing beside eleven that worked — a phone showing a match with a healthy
 * timeline should not give a third of the screen to the fact that the stats
 * panel is missing.
 *
 * So this is the small one: a hairline row, the fact, and an optional retry.
 * It stays inside the layout the working content already established, which is
 * the point — a failure that reflows the page is a failure twice.
 *
 * `role="status"` with `aria-live="polite"`, because this appears in place
 * after the page has already been announced and there is no navigation event
 * to carry it.
 */
export function InlineError({
  /**
   * What is missing, in the fan's words: "Stats", "This club's squad". The
   * component supplies the rest of the sentence, so every one of these reads
   * the same way across the product.
   */
  what,
  /** A retry, when there is a real one — a Server Action, a router refresh.
   *  Omit it rather than offering a button that reloads the page. */
  action,
  className,
}: {
  what: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-hairline-soft bg-surface-1 px-4 py-3",
        className,
      )}
    >
      <p className="text-sm text-foreground-muted">{what} didn&apos;t load just now.</p>
      {action}
    </div>
  );
}
