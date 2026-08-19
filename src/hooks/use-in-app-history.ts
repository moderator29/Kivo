"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import {
  IN_APP_DEPTH_KEY,
  canPopHistory,
  initialInAppDepth,
  nextDepth,
  normaliseDepth,
  type DocumentNavigationType,
} from "@/lib/back-navigation";

/**
 * Knows, at any moment, whether there is a KIVO page behind the current one.
 *
 * The browser cannot answer this. `window.history.length` counts entries from
 * other sites too, so it says "yes, go back" to somebody who arrived on a
 * fixture page straight from WhatsApp — and `router.back()` then takes them
 * back to WhatsApp. `document.referrer` is empty under most referrer policies
 * and lies across a client-side navigation. Next's own router exposes no
 * "can I go back" signal (checked against
 * node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md
 * for this version — `back()`, `forward()`, `push()`, `replace()`, `refresh()`,
 * `prefetch()`, `bfcacheId`, and nothing else).
 *
 * So KIVO counts its own. One module-level counter per tab, moved by exactly
 * two events:
 *
 * - a pathname change that was not a history traversal → one entry pushed
 * - a `popstate` → one entry consumed
 *
 * `PerformanceNavigationTiming.type` decides what the count starts at on a
 * fresh document: a `navigate` load is a new run from outside (a share, a
 * notification, a typed URL, a new tab) and starts at zero even if this tab
 * held a KIVO session earlier, while a `reload` or a `back_forward` restore
 * lands on an entry whose stack is still intact and keeps the stored count.
 *
 * Deliberately NOT written into `window.history.state`, which would be the
 * textbook place for it: Next's App Router rewrites the current entry's state
 * on every commit (see the `appRouterState` effect in
 * node_modules/next/dist/client/components/app-router.js, which builds a fresh
 * `{ __NA, __PRIVATE_NEXTJS_INTERNALS_TREE }` object and `replaceState`s it),
 * and child effects run before parent effects, so a marker written here would
 * be wiped on the very next commit. A counter Next does not own cannot be
 * clobbered by Next.
 *
 * The arithmetic itself is in src/lib/back-navigation.ts, under test.
 */

type Store = {
  depth: number;
  started: boolean;
  lastPath: string | null;
  /** Set by the popstate listener, consumed by the next pathname change. */
  traversed: boolean;
  listeners: Set<() => void>;
};

const store: Store = {
  depth: 0,
  started: false,
  lastPath: null,
  traversed: false,
  listeners: new Set(),
};

function readNavigationType(): DocumentNavigationType {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") return null;
  const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  return (entry?.type as DocumentNavigationType) ?? null;
}

/** sessionStorage is per-tab and can throw outright (Safari private browsing,
 * a locked-down enterprise profile), so every touch of it is guarded and the
 * in-memory counter is the real source of truth. */
function readStoredDepth(): number | null {
  try {
    const raw = window.sessionStorage.getItem(IN_APP_DEPTH_KEY);
    return raw === null ? null : normaliseDepth(Number.parseInt(raw, 10));
  } catch {
    return null;
  }
}

function writeStoredDepth(depth: number): void {
  try {
    window.sessionStorage.setItem(IN_APP_DEPTH_KEY, String(depth));
  } catch {
    /* Nothing to do and nothing to report: the counter still works in memory,
       it just will not survive a reload. */
  }
}

function emit() {
  for (const listener of store.listeners) listener();
}

function start() {
  if (store.started) return;
  store.started = true;
  store.depth = initialInAppDepth(readNavigationType(), readStoredDepth());
  writeStoredDepth(store.depth);
  window.addEventListener("popstate", onPopState);
}

function onPopState() {
  // A traversal that lands on the same pathname (a hash or query change) never
  // reaches recordPath, so settle it here as well as flagging it.
  store.traversed = true;
}

/**
 * Records that the app is now showing `pathname`. Idempotent per path, so it
 * is safe for every mounted back control to call it alongside the app-wide
 * tracker — the first call for a given path moves the counter and the rest
 * are no-ops.
 */
export function recordPath(pathname: string): void {
  start();
  if (store.lastPath === null) {
    store.lastPath = pathname;
    return;
  }
  if (store.lastPath === pathname) return;

  const kind = store.traversed ? "pop" : "push";
  store.traversed = false;
  store.lastPath = pathname;

  const updated = nextDepth(store.depth, kind);
  if (updated === store.depth) return;
  store.depth = updated;
  writeStoredDepth(updated);
  emit();
}

function subscribe(listener: () => void): () => void {
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return canPopHistory(store.depth);
}

/** Always false on the server, so the first client render matches the HTML and
 * the control starts life as a plain link to its fallback — the correct answer
 * until the counter has had a chance to say otherwise. */
function getServerSnapshot(): boolean {
  return false;
}

/** True only when `router.back()` is guaranteed to land on another KIVO page. */
export function useCanGoBack(): boolean {
  const pathname = usePathname();

  useEffect(() => {
    recordPath(pathname ?? "/");
  }, [pathname]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Test seam: resets the module counter between cases. Never called by the app. */
export function __resetInAppHistoryForTests(): void {
  store.depth = 0;
  store.started = false;
  store.lastPath = null;
  store.traversed = false;
  store.listeners.clear();
}
