"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Is this element's text actually being cut off by its `line-clamp`?
 *
 * KN-70. `PostCard` used to create one `ResizeObserver` per post to answer
 * this. On a feed that pages 20 at a time and accumulates without bound, that
 * is 100+ live observers, each with its own callback and its own entry in the
 * browser's observation list, all watching for the same thing: the column got
 * wider or narrower.
 *
 * One observer can watch every element instead. `ResizeObserver` is explicitly
 * designed for this — a single instance takes many targets and delivers one
 * batched callback per frame containing only the entries that actually
 * changed, so 100 posts cost one callback rather than 100.
 *
 * The pure-CSS alternative the item suggests does not exist yet: there is no
 * selector that matches "this element's content overflows its line clamp"
 * (`:has()` cannot compare scrollHeight to clientHeight), so measuring is
 * genuinely required. What was avoidable was measuring 100 times over.
 */

/** Created lazily, shared by every element, never torn down — one object for
 *  the lifetime of the tab is cheaper than churning one per mount. */
let observer: ResizeObserver | null = null;
const callbacks = new Map<Element, () => void>();

function ensureObserver(): ResizeObserver {
  observer ??= new ResizeObserver((entries) => {
    for (const entry of entries) callbacks.get(entry.target)?.();
  });
  return observer;
}

function observe(element: Element, onResize: () => void): () => void {
  callbacks.set(element, onResize);
  ensureObserver().observe(element);
  return () => {
    callbacks.delete(element);
    observer?.unobserve(element);
  };
}

/**
 * @param ref     the clamped element
 * @param resetOn a value that changes when the content does, so the
 *                measurement is retaken (e.g. the post body itself)
 */
export function useIsClamped(ref: RefObject<HTMLElement | null>, resetOn: unknown): boolean {
  const [clamped, setClamped] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = () => {
      // One pixel of slack: sub-pixel line heights make scrollHeight exceed
      // clientHeight by a fraction on plenty of unclamped elements.
      setClamped(element.scrollHeight - element.clientHeight > 1);
    };

    measure();
    return observe(element, measure);
  }, [ref, resetOn]);

  return clamped;
}
