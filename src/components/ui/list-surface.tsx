import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One surface, hairline-divided rows.
 *
 * This is the single most important container in the product and the one the
 * codebase kept getting wrong. `CONTAINER_ROLES.row` in
 * `src/lib/design-system.ts` has always said it: "One item among many inside a
 * grouped card. It inherits the card's corners and is separated by a hairline,
 * never by its own box — stacked boxes are what makes a list look cluttered."
 * The product shipped with almost every list built the other way — a glass
 * card per item, stacked with a gap — which is ten borders, ten shadows and
 * ten backdrop blurs where there should be one, and it is most of what "looks
 * like an AI-generated dashboard" is describing. It is also why a phone fit
 * five items where a real football app fits ten.
 *
 * `MatchList` (src/components/matches/match-list.tsx) is the fixture-specific
 * version of this and came first; it stays, because a fixture row has a time
 * rail and two stacked clubs and is genuinely denser than a general list. This
 * is the one for everything else: squads, standings, settings, followers,
 * competitions.
 */
export function ListSurface({
  children,
  /**
   * Drops the glass and the corners, for a list that already sits inside a
   * `<Section surface="panel">` or another card. A card inside a card is the
   * nesting `DENSITY_RULES` ("one divider weight per boundary") exists to
   * prevent, and it is what makes a screen read as jammed.
   */
  inset = false,
  /**
   * `ul` by default. Use `ol` when the order carries meaning — a league table,
   * a top-scorer list — because then the numbering is a fact about the data
   * and a screen reader should say so.
   */
  as: List = "ul",
  className,
}: {
  children: ReactNode;
  inset?: boolean;
  as?: "ul" | "ol";
  className?: string;
}) {
  return (
    <div className={cn(inset ? "-mx-1" : "kivo-glass overflow-hidden rounded-2xl", className)}>
      <List className="flex flex-col divide-y divide-hairline-soft">{children}</List>
    </div>
  );
}

/**
 * One row.
 *
 * Slots rather than children, because the alignment across a list is the whole
 * point: a leading crest column that starts on the same x for every row is
 * what lets the eye read down a list instead of reading each row in turn. A
 * `children` API would have every caller re-deciding that per surface, which
 * is exactly how four different match rows happened.
 *
 * `href` makes the entire row the target — one tab stop, one accessible name.
 * A dense list is read, not navigated sideways from; three links inside a row
 * means three tab stops per item and a screen reader announcing the same club
 * twice.
 */
export function ListRow({
  href,
  /** A crest, an avatar, a position number. Keep it to a fixed width across
   *  the list so the column reads as a column. */
  leading,
  /** The name. The one thing the row is about. */
  title,
  /** One line under the title. Metadata that is still meant to be read. */
  subtitle,
  /** The right-hand value: a score, a count, a rating. Right-aligned and
   *  tabular so a column of them lines up on the decimal. */
  trailing,
  /** Set when the row leads somewhere and you want the affordance. Ignored
   *  without an `href` — a chevron on a row that does not navigate is a lie. */
  chevron = false,
  /** Marks the viewer's own row, or the row under the cursor in a list the
   *  page is driving. One step up the surface ladder, never a colour. */
  selected = false,
  className,
}: {
  href?: string;
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  selected?: boolean;
  className?: string;
}) {
  const body = (
    <>
      {leading && <span className="flex shrink-0 items-center">{leading}</span>}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-foreground">{title}</span>
        {subtitle && <span className="truncate text-xs text-foreground-subtle">{subtitle}</span>}
      </span>
      {trailing && (
        <span className="shrink-0 text-sm tabular-nums text-foreground-muted">{trailing}</span>
      )}
      {href && chevron && (
        <ChevronRight
          className="h-4 w-4 shrink-0 text-foreground-subtle"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      )}
    </>
  );

  // px-4 py-3 / gap-3 is CONTAINER_ROLES.row verbatim. min-h-11 makes the row a
  // real 44px target even when its content is a single short line.
  const shape = cn(
    "flex min-h-11 items-center gap-3 px-4 py-3",
    selected && "bg-surface-2",
    className,
  );

  return (
    <li>
      {href ? (
        <Link
          href={href}
          className={cn(
            shape,
            "kivo-focus transition-colors duration-150 hover:bg-surface-2 motion-reduce:transition-none",
          )}
        >
          {body}
        </Link>
      ) : (
        <div className={shape}>{body}</div>
      )}
    </li>
  );
}
