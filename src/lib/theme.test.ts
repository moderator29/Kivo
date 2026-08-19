import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCE,
  DEFAULT_THEME,
  THEME_COLOR,
  isThemePreference,
  resolveTheme,
} from "./theme";

/**
 * The theme decision had no test, and it is exactly the kind of thing that
 * regresses invisibly: nothing fails, nothing logs, a stranger just opens the
 * link and sees the wrong product.
 *
 * The founder's report was that clicking the platform link showed light mode.
 * The cause was the default preference being "system", so a phone set to light
 * decided what KIVO looked like to somebody who had never opened Settings.
 * These pin the fix and the three things it must not break.
 */

describe("DEFAULT_PREFERENCE", () => {
  it("is dark, so a first-time visitor never gets light from their OS", () => {
    expect(DEFAULT_PREFERENCE).toBe("dark");
  });

  it("resolves to dark whatever the device reports", () => {
    // The whole point: both branches of the system query give dark, because
    // the query is not consulted at all for this preference.
    expect(resolveTheme(DEFAULT_PREFERENCE, true)).toBe("dark");
    expect(resolveTheme(DEFAULT_PREFERENCE, false)).toBe("dark");
  });

  it("agrees with what the server stamps on <html>", () => {
    // layout.tsx renders data-theme={DEFAULT_THEME} and the provider's server
    // snapshot returns DEFAULT_PREFERENCE. If these two disagreed, the
    // hydration pass would paint one theme and the next render another — the
    // white flash the pre-paint script exists to prevent.
    expect(resolveTheme(DEFAULT_PREFERENCE, false)).toBe(DEFAULT_THEME);
  });
});

describe("resolveTheme", () => {
  it("still defers to the device for somebody who chose system", () => {
    // "system" is a choice, not the default. Someone who picks it must keep
    // getting their OS's answer — changing the default must not quietly turn
    // this into a third way of saying dark.
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
  });

  it("honours an explicit choice over the device", () => {
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("dark", true)).toBe("dark");
  });

  it("falls to dark when the device cannot answer", () => {
    // A browser with no prefers-color-scheme support reports `matches: false`
    // for the light query, which must read as "not light" rather than as an
    // error — see the query-direction note in theme-script.tsx.
    expect(resolveTheme("system", false)).toBe("dark");
  });
});

describe("isThemePreference", () => {
  it("accepts the three real preferences and nothing else", () => {
    for (const value of ["system", "light", "dark"]) expect(isThemePreference(value)).toBe(true);
    // A stored value that fails this is what makes the caller fall back to
    // DEFAULT_PREFERENCE, so a false negative here would send a real chooser
    // back to dark on every load.
    for (const value of [null, undefined, "", "DARK", "auto", 0, {}]) {
      expect(isThemePreference(value)).toBe(false);
    }
  });
});

describe("THEME_COLOR", () => {
  it("carries a colour for both painted themes", () => {
    // This tints iOS Safari's chrome and Android's toolbar. A missing entry
    // renders as a white bar above a black page on a phone.
    expect(THEME_COLOR.dark).toMatch(/^#[0-9a-f]{6}$/);
    expect(THEME_COLOR.light).toMatch(/^#[0-9a-f]{6}$/);
    expect(THEME_COLOR.dark).not.toBe(THEME_COLOR.light);
  });
});
