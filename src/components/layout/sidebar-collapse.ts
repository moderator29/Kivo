"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether the desktop sidebar is collapsed to icons.
 *
 * KN-77. On a 1280px laptop — the most common real desktop width — a fixed
 * 256px rail plus a max-w-2xl content column leaves content occupying under
 * half the viewport. Collapsing to a 64px icon rail gives that back without
 * hiding navigation entirely.
 *
 * Stored in localStorage and read through `useSyncExternalStore`, matching
 * the pattern the theme provider already established for state that lives
 * outside React (see src/components/theme/theme-provider.tsx for the full
 * reasoning — mirroring into useState via an effect tears under concurrent
 * rendering and costs a cascading render on every mount).
 *
 * The server snapshot is `false`: expanded is the state the sidebar renders in
 * the initial HTML, so a first paint never flashes a collapsed rail at a user
 * who has not collapsed it. A user who *has* collapsed it sees one frame of the
 * expanded rail — a 64px-wide layout shift confined to the sidebar, which is a
 * far cheaper wrong guess than the reverse.
 */
const STORAGE_KEY = "kivo-sidebar-collapsed";

const listeners = new Set<() => void>();
let cached: boolean | null = null;

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function handleStorage(event: StorageEvent) {
  if (event.key !== STORAGE_KEY) return;
  cached = null;
  listeners.forEach((listener) => listener());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (listeners.size === 1) window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) window.removeEventListener("storage", handleStorage);
  };
}

function getSnapshot(): boolean {
  if (cached === null) cached = read();
  return cached;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useSidebarCollapsed(): [boolean, () => void] {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const next = !getSnapshot();
    cached = next;
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Private mode: applies for this session, just not persisted.
    }
    listeners.forEach((listener) => listener());
  }, []);

  return [collapsed, toggle];
}
