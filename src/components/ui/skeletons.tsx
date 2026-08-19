import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The skeleton family, one per real primitive.
 *
 * ## The only rule
 *
 * **A load must never end in a reflow.** A skeleton is a promise about where
 * things will be, and the most visible way to break it is to get the geometry
 * wrong: content lands, and the page jumps. That is worse than showing
 * nothing, because nothing at least does not lie about the layout.
 *
 * So every skeleton here is written next to the component it stands in for and
 * repeats its numbers on purpose — `min-h-11 px-4 py-3 gap-3` is `<ListRow>`'s
 * box, not an approximation of it, and the bars inside are the height of the
 * text they replace (14px for `text-sm`, 12px for `text-xs`) rather than
 * whatever looked about right. When one of those numbers changes, both files
 * change; that is the cost of the promise being kept.
 *
 * The shimmer is `.kivo-skeleton` in globals.css. It is a single low-contrast
 * sweep and it turns itself off entirely under `prefers-reduced-motion` —
 * forty bars pulsing is exactly the kind of thing that motion setting exists
 * to stop.
 *
 * Bars carry `aria-hidden` (see `<Skeleton>`); the *container* announces the
 * wait once, with a name, via `<PageSkeleton>`. A screen reader that read forty
 * unlabelled boxes would be worse than the silence it replaced.
 */

/** Alternating widths so a stack of rows reads as a list of different things
 *  rather than as a grid. Deterministic — a random width would change between
 *  the server render and the client one and warn about a hydration mismatch. */
const NAME_WIDTHS = ["w-32", "w-24", "w-28", "w-36", "w-24", "w-30"];

function nameWidth(index: number) {
  return NAME_WIDTHS[index % NAME_WIDTHS.length];
}

/**
 * `<PageHeader>`'s opening block: the `h1` and its one line of subtitle.
 *
 * The bar heights are the *line* heights of the real text, not its font size —
 * `text-2xl` occupies 32px and `text-sm` occupies 20px — because a skeleton
 * that matches the font size and not the leading is short by a few pixels per
 * line, and the page still nudges upward when the words arrive.
 *
 * Two route skeletons used to write these numbers out by hand with a comment
 * saying which component they were copied from. That comment is the tell: a
 * number copied between files is a number that will be right until one of them
 * changes.
 */
export function PageHeaderSkeleton({
  /** Match the real page: a header with no subtitle should not skeleton one. */
  description = true,
  /** Widths, in the same spirit as the row widths above — a title bar the full
   *  width of the column reads as a paragraph rather than as a heading. */
  titleWidth = "w-40",
}: {
  description?: boolean;
  titleWidth?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5" aria-hidden="true">
      <Skeleton className={cn("h-8", titleWidth)} />
      {description && <Skeleton className="h-5 w-64" />}
    </div>
  );
}

/**
 * `<SectionTabs>`' rail. Matches its 44px minimum and its bottom hairline, so
 * the panel below it starts on the same line before and after the load.
 */
export function SectionTabsSkeleton({ tabs = 5 }: { tabs?: number }) {
  return (
    <div className="border-b border-hairline" aria-hidden="true">
      <div className="flex items-stretch overflow-hidden">
        {Array.from({ length: tabs }).map((_, i) => (
          <div key={i} className="flex min-h-11 shrink-0 items-center px-4">
            <Skeleton className={cn("h-3.5", i % 2 === 0 ? "w-16" : "w-12")} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * `<ListSurface>` + `<ListRow>`. The general list: squads, followers,
 * competitions, settings.
 *
 * For a fixture list use `<MatchListSkeleton>` (match-list.tsx) instead — that
 * row has a time rail and two stacked clubs and is a genuinely different shape.
 */
export function ListSkeleton({
  rows = 6,
  /** Matches `<ListRow leading>`. `circle` for a player or a person, `square`
   *  for a crest or a competition badge, `none` when the row has no leading
   *  column at all. */
  leading = "circle",
  /** Matches `<ListRow subtitle>` — a second line the real row will have. */
  subtitle = true,
  /** Matches `<ListRow trailing>`. */
  trailing = false,
  inset = false,
}: {
  rows?: number;
  leading?: "circle" | "square" | "none";
  subtitle?: boolean;
  trailing?: boolean;
  inset?: boolean;
}) {
  return (
    <div
      className={cn(inset ? "-mx-1" : "kivo-glass overflow-hidden rounded-2xl")}
      aria-hidden="true"
    >
      <div className="flex flex-col divide-y divide-hairline-soft">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex min-h-11 items-center gap-3 px-4 py-3">
            {leading !== "none" && (
              <Skeleton
                className={cn("h-7 w-7 shrink-0", leading === "circle" ? "rounded-full" : "rounded-md")}
              />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className={cn("h-3.5", nameWidth(i))} />
              {subtitle && <Skeleton className="h-3 w-20" />}
            </div>
            {trailing && <Skeleton className="h-3.5 w-8 shrink-0" />}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A league table. Same surface and dividers as `<ListSkeleton>`, but with the
 * position rail and the numeric columns a standings row really has, so the
 * columns do not shift sideways when the table arrives.
 */
export function TableSkeleton({
  rows = 10,
  /** The numeric columns after the club name: P W D L GD Pts, or fewer on a
   *  narrow table. Count them on the real table. */
  columns = 4,
  header = true,
}: {
  rows?: number;
  columns?: number;
  header?: boolean;
}) {
  return (
    <div className="kivo-glass overflow-hidden rounded-2xl" aria-hidden="true">
      {header && (
        <div className="flex items-center gap-3 border-b border-hairline px-4 py-2.5">
          <div className="w-5 shrink-0" />
          <div className="min-w-0 flex-1" />
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className="h-2.5 w-5 shrink-0" />
          ))}
        </div>
      )}
      <div className="flex flex-col divide-y divide-hairline-soft">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex min-h-11 items-center gap-3 px-4 py-3">
            <Skeleton className="h-3 w-5 shrink-0" />
            <Skeleton className="h-5 w-5 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1">
              <Skeleton className={cn("h-3.5", nameWidth(i))} />
            </div>
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton key={c} className="h-3 w-5 shrink-0" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A squad, as tiles. Matches a fixed-column grid rather than an `auto-fit` one
 * for the same reason `<StatGrid>` does: a grid that reflows across a
 * breakpoint puts a given player in a different place on every screen.
 */
export function SquadGridSkeleton({ players = 12 }: { players?: number }) {
  return (
    <div
      className="kivo-glass grid grid-cols-3 gap-x-3 gap-y-5 rounded-2xl p-5 sm:grid-cols-4"
      aria-hidden="true"
    >
      {Array.from({ length: players }).map((_, i) => (
        <div key={i} className="flex flex-col items-center gap-2">
          <Skeleton className="h-14 w-14 rounded-full" />
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-2.5 w-10" />
        </div>
      ))}
    </div>
  );
}

/**
 * `<StatGrid>` + `<StatBlock>`. The value bar is 20px because the real value
 * is `text-xl`, and the label bar is 11px because the label is the one
 * sanctioned use of that size.
 */
export function StatGridSkeleton({ stats = 6, columns = 3 }: { stats?: number; columns?: 2 | 3 | 4 }) {
  return (
    <div
      className={cn(
        "kivo-glass grid gap-x-3 gap-y-5 rounded-2xl p-5",
        columns === 2 && "grid-cols-2 sm:grid-cols-4",
        columns === 3 && "grid-cols-3 sm:grid-cols-6",
        columns === 4 && "grid-cols-4",
      )}
      aria-hidden="true"
    >
      {Array.from({ length: stats }).map((_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <Skeleton className="h-5 w-10" />
          <Skeleton className="h-2.5 w-12" />
        </div>
      ))}
    </div>
  );
}

/**
 * A post or an article: author line, body, and the space its actions occupy.
 *
 * The body is three bars with the last one short, because that is what a
 * paragraph looks like and a block of three equal bars reads as a table.
 */
export function PostSkeleton({ posts = 3 }: { posts?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {Array.from({ length: posts }).map((_, i) => (
        <div key={i} className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className={cn("h-3.5", nameWidth(i))} />
              <Skeleton className="h-2.5 w-16" />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
          <div className="flex gap-4 pt-1">
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-3 w-10" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * A `<Section>`'s heading row, for a section whose title is itself loaded
 * (a club's name, a competition's). A section with a static title should
 * render the real title and skeleton only its body — a heading that flickers
 * from grey bar to text on every load is noisier than one that never moved.
 */
export function SectionHeadingSkeleton({ action = false }: { action?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3" aria-hidden="true">
      <Skeleton className="h-5 w-32" />
      {action && <Skeleton className="h-3.5 w-14 shrink-0" />}
    </div>
  );
}
