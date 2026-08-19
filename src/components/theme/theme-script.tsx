import { DEFAULT_PREFERENCE, DEFAULT_THEME, THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * Applies the stored theme to `<html>` BEFORE the browser paints anything.
 *
 * This has to be a blocking, inline, non-module script in `<head>`: any
 * approach that waits for React (an effect, a client component's first
 * render, even a deferred script) paints the server's default theme first
 * and then swaps, which is a full-screen white-to-black flash on every
 * navigation into the app. That flash is the single most visible way a
 * theme system can feel broken, so this runs synchronously and costs ~400
 * bytes.
 *
 * Deliberately duplicates the storage key and default rather than importing
 * them as values into the string — the script executes long before any
 * bundle, so it cannot reference module scope. `THEME_STORAGE_KEY` and
 * `DEFAULT_THEME` are interpolated at build time instead, which keeps the
 * two definitions from drifting.
 *
 * Reads `prefers-color-scheme: light` (not `dark`) so a browser that does
 * not support the query at all — `matches` is `false` — falls through to
 * dark, matching DEFAULT_THEME rather than accidentally forcing light.
 *
 * With NOTHING stored, the preference is `DEFAULT_PREFERENCE` ("dark"), not
 * "system" — so the OS is never consulted for a first-time visitor and the
 * link opens in KIVO's dark on a light-set phone. The media query below still
 * runs, and still decides, for somebody who has actually chosen "system".
 */
export function ThemeScript() {
  const script = `(function(){try{var s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var p=(s==="light"||s==="dark"||s==="system")?s:${JSON.stringify(DEFAULT_PREFERENCE)};var t=p==="system"?(window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):p;var e=document.documentElement;e.setAttribute("data-theme",t);e.style.colorScheme=t;}catch(_){document.documentElement.setAttribute("data-theme",${JSON.stringify(DEFAULT_THEME)});}})();`;

  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
