"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

export type PopoverPlacement = { vertical: "top" | "bottom"; horizontal: "left" | "right" };

/**
 * Real viewport-edge collision detection for a small absolutely-positioned
 * popover anchored to a trigger element (RECOMMENDATIONS item 238:
 * `reaction-picker.tsx`'s emoji strip and post-card.tsx's report-reason menu
 * both used to position with a bare `absolute bottom-full left-0`/`right-0`
 * and no collision check, so either could render off-screen near a viewport
 * edge). Measures the trigger's own wrapper with `getBoundingClientRect()`
 * once, when the popover opens, and flips to the opposite side whenever the
 * default direction doesn't have enough room — a lightweight approach
 * rather than pulling in a full positioning library the rest of the
 * codebase doesn't otherwise depend on.
 *
 * `containerRef` must be the same `relative`-positioned element the popover
 * itself is `absolute`-anchored against, so the measured rect matches what
 * the popover's default offsets (`bottom-full`/`left-0` etc.) are relative
 * to. `estimatedHeight`/`estimatedWidth` only need to be a reasonable upper
 * bound on the popover's real rendered size — used before that size is
 * knowable (the popover isn't in the DOM yet on the frame this runs), so a
 * slightly generous estimate is the safe direction to round.
 */
export function usePopoverPlacement(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  options?: {
    estimatedHeight?: number;
    estimatedWidth?: number;
    defaultVertical?: "top" | "bottom";
    defaultHorizontal?: "left" | "right";
  },
): PopoverPlacement {
  const defaultVertical = options?.defaultVertical ?? "top";
  const defaultHorizontal = options?.defaultHorizontal ?? "left";
  const estimatedHeight = options?.estimatedHeight ?? 220;
  const estimatedWidth = options?.estimatedWidth ?? 200;

  const [placement, setPlacement] = useState<PopoverPlacement>({
    vertical: defaultVertical,
    horizontal: defaultHorizontal,
  });

  // Layout effect (not a plain effect): runs before paint so the popover
  // never flashes in the colliding position before flipping. No-ops while
  // closed — the popover isn't rendered then, so there's nothing to
  // reposition, and resetting placement here too would just be a second
  // setState call in the same effect for no visible benefit.
  useLayoutEffect(() => {
    if (!open) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    let vertical = defaultVertical;
    if (defaultVertical === "top" && rect.top < estimatedHeight) vertical = "bottom";
    else if (defaultVertical === "bottom" && viewportHeight - rect.bottom < estimatedHeight) vertical = "top";

    let horizontal = defaultHorizontal;
    if (defaultHorizontal === "left" && rect.left + estimatedWidth > viewportWidth) horizontal = "right";
    else if (defaultHorizontal === "right" && rect.right - estimatedWidth < 0) horizontal = "left";

    setPlacement({ vertical, horizontal });
  }, [open, containerRef, defaultVertical, defaultHorizontal, estimatedHeight, estimatedWidth]);

  return placement;
}
