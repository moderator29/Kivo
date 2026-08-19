import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A titled block of a page.
 *
 * The founder's note — "looks like an AI-generated dashboard, not a real
 * football product" — is, structurally, a note about this. Every screen was a
 * stack of glass cards of roughly equal weight, so a page had no shape: the
 * squad list, the next fixture and a settings toggle all arrived as the same
 * box. Real football products give a page a small number of *named regions*
 * and put the surface only where the content genuinely needs one.
 *
 * So the default here is **no surface at all**. A heading, an optional action
 * on the right, and the content. `<ListSurface>` or `<StatGrid>` inside it
 * bring their own container when the content is a list or a grid; a paragraph
 * of prose does not need one, and wrapping it in glass is how the dashboard
 * look happens.
 *
 * Spacing follows `DENSITY_RULES` "vertical rhythm is coarse, not fine":
 * `gap-3` inside a section, and the gap *between* sections belongs to
 * `.kivo-page`, not to this component. A section that set its own outer margin
 * would give the page two competing rhythms.
 */
export function Section({
  title,
  /** One line under the heading. Say what the fan is looking at, not how it
   *  was produced. */
  description,
  /** A single control on the heading row: a "See all" link, a season picker.
   *  More than one belongs in the body. */
  action,
  /**
   * `h2` is right for a section of a page, which is nearly always. Drop to
   * `h3` for a section nested inside another one — a heading level that skips
   * is the most common way a well-built page still reads as a jumble to a
   * screen reader.
   */
  as: Heading = "h2",
  /**
   * `panel` gives the section its own glass container, for a region that is
   * genuinely one unit and holds mixed content. Use it sparingly: `panel`
   * padding is `p-6` because a panel holds other containers, and two panels
   * inside one another is the nesting `DENSITY_RULES` forbids.
   */
  surface = "none",
  children,
  className,
  id,
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  as?: "h2" | "h3";
  surface?: "none" | "panel";
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "flex flex-col gap-3",
        surface === "panel" && "kivo-glass rounded-2xl p-6",
        className,
      )}
    >
      {(title || action) && (
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title && (
              <Heading className="text-lg font-semibold tracking-tight text-foreground">{title}</Heading>
            )}
            {description && <p className="text-sm text-foreground-muted">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {/* Only when the heading row is absent, so the description is not
          orphaned above content it belongs to. */}
      {!title && !action && description && <p className="text-sm text-foreground-muted">{description}</p>}
      {children}
    </section>
  );
}

/**
 * The smallest heading in the system: a caps label above a short block.
 *
 * `TYPE_STEPS` sanctions 11px in exactly one place — uppercase, tracked,
 * subtle — because caps height buys back the legibility the size costs. This
 * component is that one place, so a call site never has to remember the four
 * classes that make it legal, and never reaches for `text-[10px]` because it
 * looked close enough.
 */
export function FieldLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle",
        className,
      )}
    >
      {children}
    </span>
  );
}
