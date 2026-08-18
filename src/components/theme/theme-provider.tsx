"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import {
  DEFAULT_THEME,
  THEME_COLOR,
  THEME_STORAGE_KEY,
  isThemePreference,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

const LIGHT_QUERY = "(prefers-color-scheme: light)";

/* ---------------------------------------------------------------------------
   External stores

   Both the stored preference and the OS preference are state that lives
   OUTSIDE React — in localStorage and in a MediaQueryList. They are read with
   `useSyncExternalStore` rather than mirrored into `useState` inside an
   effect: mirroring would mean a synchronous setState during the first effect
   pass (a cascading re-render on every mount, and what
   `react-hooks/set-state-in-effect` exists to catch), and it would tear under
   concurrent rendering, where two components could read different values of
   the same underlying source within one render pass.

   The `getServerSnapshot` implementations return the same values the server
   HTML was rendered with, so hydration matches and React swaps to the real
   values immediately afterwards.
--------------------------------------------------------------------------- */

const preferenceListeners = new Set<() => void>();
let cachedPreference: ThemePreference | null = null;

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    // Private mode / storage disabled. "system" is still fully functional —
    // the choice just will not survive a reload.
    return "system";
  }
}

function handleStorage(event: StorageEvent) {
  // Cross-tab sync: changing the theme in one tab should not leave another
  // tab of the same app on the old one.
  if (event.key !== THEME_STORAGE_KEY) return;
  cachedPreference = null;
  preferenceListeners.forEach((listener) => listener());
}

function subscribePreference(onChange: () => void) {
  preferenceListeners.add(onChange);
  if (preferenceListeners.size === 1) window.addEventListener("storage", handleStorage);
  return () => {
    preferenceListeners.delete(onChange);
    if (preferenceListeners.size === 0) window.removeEventListener("storage", handleStorage);
  };
}

function getPreferenceSnapshot(): ThemePreference {
  // Cached because getSnapshot runs on every render pass and React requires it
  // to be cheap and referentially stable between real changes.
  if (cachedPreference === null) cachedPreference = readStoredPreference();
  return cachedPreference;
}

function getPreferenceServerSnapshot(): ThemePreference {
  return "system";
}

function writePreference(next: ThemePreference) {
  cachedPreference = next;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // As above — applies for this session, just not persisted.
  }
  preferenceListeners.forEach((listener) => listener());
}

function subscribeSystem(onChange: () => void) {
  const media = window.matchMedia(LIGHT_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getSystemSnapshot() {
  return window.matchMedia(LIGHT_QUERY).matches;
}

function getSystemServerSnapshot() {
  // Matches DEFAULT_THEME: a browser with no support for the query reports
  // `false` too, so both fall through to dark rather than to light.
  return false;
}

/** Standard hydration probe — `true` only once React is running on the client. */
function subscribeNever() {
  return () => {};
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

type ThemeContextValue = {
  /** What the user picked, including "system". */
  preference: ThemePreference;
  /** What is actually painted right now. */
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
  /**
   * False during server render and the hydration pass. Theme controls read
   * their state from localStorage, which the server cannot see, so they show
   * a neutral state until this flips rather than guessing and then correcting
   * themselves a frame later.
   */
  ready: boolean;
};

function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  // Keeps native chrome — scrollbars, native <select> popups, date pickers,
  // autofill styling — in step with the page.
  root.style.colorScheme = resolved;

  // <meta name="theme-color"> is rendered statically from the `viewport`
  // export and cannot express "the user chose light on a dark-set OS", so it
  // is patched here. Without this, an iPhone running the app in light mode
  // still paints its status bar obsidian.
  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) meta.setAttribute("content", THEME_COLOR[resolved]);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSyncExternalStore(
    subscribePreference,
    getPreferenceSnapshot,
    getPreferenceServerSnapshot,
  );
  const systemPrefersLight = useSyncExternalStore(
    subscribeSystem,
    getSystemSnapshot,
    getSystemServerSnapshot,
  );
  const ready = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  const resolved = ready ? resolveTheme(preference, systemPrefersLight) : DEFAULT_THEME;

  // The one genuine effect here: pushing React's resolved value out to the
  // DOM. The pre-paint script has already set the same attribute for the
  // initial load, so on mount this is a no-op write; it earns its keep on
  // every subsequent change.
  useEffect(() => {
    if (!ready) return;
    applyTheme(resolved);
  }, [ready, resolved]);

  const setPreference = useCallback((next: ThemePreference) => writePreference(next), []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference, ready }),
    [preference, resolved, setPreference, ready],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within <ThemeProvider>");
  return context;
}
