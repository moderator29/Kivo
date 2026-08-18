/**
 * Theme vocabulary shared between the blocking pre-paint script, the client
 * provider, and the settings UI. Everything here is deliberately dependency-
 * free and stringly-typed so the same constants can be inlined verbatim into
 * the `<head>` script (which runs before any module graph exists).
 */

/** What the user chose. "system" defers to the OS and keeps deferring. */
export type ThemePreference = "system" | "light" | "dark";

/** What is actually painted. "system" is always resolved to one of these. */
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "kivo-theme";

/**
 * The value written to `<meta name="theme-color">` per resolved theme, which
 * is what tints iOS Safari's chrome and Android's toolbar. These MUST track
 * `--background` in globals.css — if they drift, the browser chrome sits a
 * shade off the page and reads as a rendering bug on mobile.
 */
export const THEME_COLOR: Record<ResolvedTheme, string> = {
  dark: "#05060a",
  light: "#f6f7f9",
};

export const THEME_PREFERENCES: ThemePreference[] = ["system", "light", "dark"];

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

/**
 * The default rendered on the server and stamped onto `<html>` in the initial
 * HTML. It is only ever visible for the microtask between HTML parse and the
 * blocking script running, but it has to be *something* — with no
 * `data-theme` at all none of the token blocks in globals.css match and the
 * page would paint unstyled. Dark, because that is what KIVO shipped as and
 * what a returning user with no stored preference on a dark-set OS gets.
 */
export const DEFAULT_THEME: ResolvedTheme = "dark";

export function resolveTheme(preference: ThemePreference, systemPrefersLight: boolean): ResolvedTheme {
  if (preference === "system") return systemPrefersLight ? "light" : "dark";
  return preference;
}
