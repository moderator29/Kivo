"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { Icon } from "@/components/ui/icon";
// Generic despite its address: `resolveTabFromSlug` is a pure slug→tab resolver
// with a legacy-alias fallback, and it happens to live in the football module
// because the Match Centre needed it first. Importing it is deliberate — a
// second copy here would be the exact drift this file exists to stop, and the
// legacy map is the thing that keeps already-shared links working.
import { resolveTabFromSlug } from "@/lib/football/match-timeline";
import { cn } from "@/lib/utils";

/**
 * KIVO's one tab bar.
 *
 * ## Why this exists
 *
 * The founder's most specific instruction about the whole product was about
 * this control: the Match Centre's sections should work the way a real
 * football app's do — one horizontal rail you flick along. Before this there
 * were two hand-rolled tablists in the codebase and every new surface was
 * about to grow a third. Match Centre, Team, Player, Competition and Social
 * all render section tabs; if they each build their own, the product reads as
 * five products, which is the note the founder actually gave.
 *
 * So this is generic on purpose. It knows nothing about football. It takes a
 * list of `{ id, label, count? }`, a selected id, and a change handler.
 *
 * ## What it does that a row of buttons does not
 *
 * - **It scrolls, and it says so.** No wrapping to a second line, no dropdown,
 *   no label truncated to make twelve fit. When the rail overflows, the edge
 *   it can scroll toward fades (`.kivo-tab-rail`, globals.css) — per edge,
 *   from real scroll position, so a three-tab rail with nothing to scroll is
 *   not ghosted at both ends for decoration.
 * - **It brings the active tab to you.** On mount and on every change, the
 *   selected tab is scrolled into view. Landing on `?tab=standings` with the
 *   rail scrolled to the far left, and nothing highlighted on screen, is the
 *   failure mode that makes a scrolling tab bar feel broken.
 * - **The indicator moves rather than jumps.** Measured from the button's own
 *   `offsetLeft`/`offsetWidth` inside the scroll content, not from viewport
 *   geometry, so a change that also scrolls the rail cannot make the indicator
 *   fly across the screen. It is the `chrome` motion vocabulary from
 *   `design-system.ts` — the user's finger caused it, so it responds like an
 *   object — and it holds still entirely under `prefers-reduced-motion`.
 * - **It is a real tablist.** `role="tab"`/`aria-selected`/`aria-controls`,
 *   one tab stop for the whole rail with roving `tabIndex`, arrow keys plus
 *   Home/End, and a focus ring drawn inside the control because a horizontal
 *   scroller clips an outset one.
 * - **44px targets.** The rail is the most-tapped control in the product and
 *   it is tapped in a hurry, usually one-handed.
 *
 * ## Selecting
 *
 * Controlled. Pair it with `useTabParam()` below to keep the choice in the
 * URL — which is what makes a tab shareable, bookmarkable, and survivable
 * across a back button.
 */

/** How much clear space to leave around a tab when scrolling it into view.
 *  Matches `scroll-padding-inline` on `.kivo-tab-rail` so a programmatic
 *  scroll lands exactly on a snap position, and exceeds the 1.5rem edge fade
 *  so a focused tab is never scrolled to a place where it is half faded. */
const SCROLL_PADDING = 32;

/** How far the underline sits inside the button on each side. The button's own
 *  padding is 16px; 10px leaves the underline visibly narrower than the cell
 *  without letting it shrink to the label on a one-word tab. */
const UNDERLINE_INSET = 10;

export type SectionTab<T extends string = string> = {
  id: T;
  /** What a fan calls this section. Never a slug, never an internal name. */
  label: string;
  /**
   * A real count, shown as a trailing badge. Omit it rather than passing 0 —
   * a tab that says "0" is a tab that should be telling you something else,
   * and KIVO never renders a number it has not actually counted.
   */
  count?: number;
  icon?: LucideIcon;
};

export function SectionTabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
  idPrefix,
  tone = "underline",
  sticky = false,
  bleed = false,
  className,
}: {
  tabs: readonly SectionTab<T>[];
  value: T;
  onChange: (next: T) => void;
  /** Names the rail for a screen reader: "Match centre sections", "Club
   *  sections". Not the page title. */
  ariaLabel: string;
  /**
   * Namespaces this rail's element ids so two rails on one page cannot
   * collide, and so `<TabPanel>` can point back at the right tab. Use a
   * stable, human-readable string: "match-centre", "team", "social".
   */
  idPrefix: string;
  /**
   * `underline` is the page-level rail: the sections of a screen, sitting
   * under the header with a hairline beneath it. `pill` is a filter inside a
   * section — a competition chooser above a fixture list, say. Two roles, and
   * the distinction is what the reader is choosing: a *place* or a *filter*.
   * Anything smaller than that is a `<Segmented>`, not a tab bar.
   */
  tone?: "underline" | "pill";
  /**
   * Sticks the rail under the app header while the panel scrolls beneath it.
   * Worth it on a long panel — a phone reading down a timeline should not have
   * to scroll back up to change section — and pointless on a short one.
   */
  sticky?: boolean;
  /**
   * Lets the rail run to the edges of the phone screen while the page's
   * content column stays padded. A tab rail that stops 16px short of the
   * screen edge looks inset; every reference app runs it full-bleed, because
   * the fade at the edge is what tells you it scrolls.
   */
  bleed?: boolean;
  className?: string;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});

  // `null` until measured. The indicator renders invisible until then so it
  // cannot appear at x=0 for one frame and then slide across the rail on
  // arrival — a page load is not something the user did, so it gets no motion.
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const settled = useRef(false);

  const measure = useCallback(() => {
    const node = tabRefs.current[value];
    if (!node) return;
    const inset = tone === "underline" ? UNDERLINE_INSET : 0;
    setIndicator({
      left: node.offsetLeft + inset,
      width: Math.max(node.offsetWidth - inset * 2, 16),
    });
  }, [tone, value]);

  const syncEdges = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const max = rail.scrollWidth - rail.clientWidth;
    // 1px of slack: sub-pixel layout leaves scrollLeft a hair short of max on
    // a fully-scrolled rail, which would otherwise fade an edge forever.
    setEdges({ start: rail.scrollLeft > 1, end: rail.scrollLeft < max - 1 });
  }, []);

  const scrollActiveIntoView = useCallback(
    (behavior: ScrollBehavior) => {
      const rail = railRef.current;
      const node = tabRefs.current[value];
      if (!rail || !node) return;
      const left = node.offsetLeft;
      const right = left + node.offsetWidth;
      let target = rail.scrollLeft;
      if (left - SCROLL_PADDING < rail.scrollLeft) {
        target = left - SCROLL_PADDING;
      } else if (right + SCROLL_PADDING > rail.scrollLeft + rail.clientWidth) {
        target = right + SCROLL_PADDING - rail.clientWidth;
      }
      if (target === rail.scrollLeft) return;
      rail.scrollTo({ left: Math.max(0, target), behavior });
    },
    [value],
  );

  useEffect(() => {
    measure();
    syncEdges();
    // The first pass is instant and every later one animates: arriving on a
    // deep-linked tab should look like the page was always that way.
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollActiveIntoView(settled.current && !reduced ? "smooth" : "auto");
    settled.current = true;
  }, [measure, scrollActiveIntoView, syncEdges, value]);

  // Fonts finishing, a count badge arriving, the viewport rotating: all of them
  // move the buttons under the indicator, and none of them change `value`.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      measure();
      syncEdges();
    });
    observer.observe(rail);
    for (const node of Object.values(tabRefs.current)) {
      if (node) observer.observe(node as HTMLButtonElement);
    }
    return () => observer.disconnect();
  }, [measure, syncEdges, tabs]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = tabs.findIndex((tab) => tab.id === value);
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    const target = tabs[next];
    onChange(target.id);
    tabRefs.current[target.id]?.focus();
  }

  return (
    <div
      className={cn(
        // The sticky element is the wrapper, never the rail itself: the rail
        // carries a mask, and a masked box cannot also be a sticky one.
        sticky && "sticky top-[var(--kivo-header-h)] z-10 bg-background/85 backdrop-blur-xl",
        bleed && "-mx-4 lg:mx-0",
        tone === "underline" && "border-b border-hairline",
        className,
      )}
    >
      <div
        ref={railRef}
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        onScroll={syncEdges}
        data-overflow-start={edges.start}
        data-overflow-end={edges.end}
        className={cn(
          "kivo-tab-rail items-stretch",
          tone === "underline" ? "gap-0" : "gap-1.5 py-1",
          bleed && "px-4 lg:px-0",
        )}
      >
        {/* One indicator for the whole rail, moved rather than re-rendered per
            tab. Absolutely positioned inside the scroll CONTENT, so it travels
            with the tabs when the rail scrolls and needs no correction.

            FIRST in the DOM, and that is load-bearing rather than tidy: both
            this and the tabs are positioned boxes with no z-index, so paint
            order is document order. Rendered last, the `pill` indicator — which
            is an opaque `--surface-raised` fill in light mode — covered the
            label of the tab it was meant to be highlighting. Dark mode hid it,
            because the same token is translucent there. */}
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute transition-[transform,width,opacity] duration-300 ease-out motion-reduce:transition-none",
            tone === "underline"
              ? "kivo-gradient-prime bottom-0 left-0 h-[3px] rounded-full"
              : "left-0 top-1 h-[calc(100%-0.5rem)] rounded-xl bg-surface-raised shadow-soft",
          )}
          style={{
            opacity: indicator ? 1 : 0,
            transform: `translateX(${indicator?.left ?? 0}px)`,
            width: indicator?.width ?? 0,
          }}
        />

        {tabs.map((tab) => {
          const active = tab.id === value;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                tabRefs.current[tab.id] = node;
              }}
              type="button"
              role="tab"
              id={`${idPrefix}-tab-${tab.id}`}
              aria-selected={active}
              aria-controls={`${idPrefix}-panel-${tab.id}`}
              // Roving tabindex: the whole rail is one tab stop and the arrow
              // keys move within it, which is what a tablist is expected to do
              // and what stops twelve tabs costing twelve presses to walk past.
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(tab.id)}
              className={cn(
                // min-h-11 is the 44px target and is not negotiable — see the
                // same number in back-link.tsx. `shrink-0` is what stops flex
                // from compressing labels to fit, which is the truncation the
                // founder explicitly did not want.
                "relative flex min-h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap",
                "text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none",
                tone === "underline"
                  ? "px-4"
                  : cn(
                      // Control radius from CONTAINER_ROLES — a pill here would
                      // read as a chip rather than a tab.
                      "rounded-xl px-3.5",
                      !active && "hover:bg-surface-2",
                    ),
                active ? "text-foreground" : "text-foreground-subtle hover:text-foreground",
              )}
            >
              {tab.icon && <Icon icon={tab.icon} size="sm" aria-hidden="true" />}
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-px text-[11px] font-semibold tabular-nums",
                    active ? "bg-accent-soft text-accent" : "bg-surface-2 text-foreground-subtle",
                  )}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}

      </div>
    </div>
  );
}

/**
 * The panel a tab controls. Renders nothing when it is not the selected one.
 *
 * Exists so the `aria-controls`/`aria-labelledby` pair is wired by
 * construction rather than by two matching template strings in two files —
 * that pair is the entire reason a screen reader announces "Line-ups, tab 3 of
 * 7" instead of reading a row of unrelated buttons, and it is silently broken
 * the moment one of the strings drifts.
 */
export function TabPanel({
  idPrefix,
  tab,
  active,
  children,
  className,
}: {
  idPrefix: string;
  tab: string;
  active: boolean;
  children: ReactNode;
  className?: string;
}) {
  if (!active) return null;
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${tab}`}
      aria-labelledby={`${idPrefix}-tab-${tab}`}
      // Focusable so that tabbing off the rail lands in the content. A panel
      // whose content is entirely non-interactive (a stats table, a timeline)
      // is otherwise unreachable by keyboard.
      tabIndex={0}
      className={cn("kivo-focus outline-none", className)}
    >
      {children}
    </div>
  );
}

/** Default slug: what the tab is called, lowercased, spaces hyphenated. */
export function tabSlug(tab: string): string {
  return tab.toLowerCase().replace(/\s+/g, "-");
}

/**
 * Keeps the selected tab in the URL.
 *
 * A tab that lives only in React state is a tab nobody can share, bookmark or
 * return to — press back after opening a player from the Line-ups tab and you
 * land on Overview, which is the small failure that makes a product feel
 * disposable.
 *
 * Two details worth keeping:
 *
 * - The update is `window.history.pushState`, not `router.push`. Next routes
 *   that through its own router and syncs `useSearchParams`
 *   (node_modules/next/dist/docs/01-app/02-guides/single-page-applications.md,
 *   "Updating the URL"), so back/forward work and the server does not re-render
 *   the page to change a tab.
 * - The first tab clears the param instead of writing `?tab=overview`. The
 *   canonical URL of a match is the match, not the match's default section.
 *
 * Resolution goes through `resolveTabFromSlug`, so a slug that used to name a
 * tab still works and a slug naming a tab that isn't currently on screen falls
 * back to the first visible one rather than leaving nothing selected.
 *
 * Requires a Suspense boundary above it, like any `useSearchParams` caller.
 */
export function useTabParam<T extends string>({
  tabs,
  param = "tab",
  toSlug = tabSlug,
  legacy,
}: {
  /** The tabs actually on screen, in rail order. The first is the default. */
  tabs: readonly T[];
  param?: string;
  toSlug?: (tab: T) => string;
  /** Slugs that used to name a tab, mapped to the tab they became. */
  legacy?: Readonly<Record<string, T>>;
}): readonly [T, (next: T) => void] {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = resolveTabFromSlug(searchParams.get(param), tabs, toSlug, legacy);

  const setActive = useCallback(
    (next: T) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === tabs[0]) params.delete(param);
      else params.set(param, toSlug(next));
      const qs = params.toString();
      window.history.pushState(null, "", qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, param, searchParams, tabs, toSlug],
  );

  return [active, setActive] as const;
}
