"use client";

import { Check, Heart, Share2 } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { useTheme } from "./theme-provider";

/**
 * Settings panel for the theme choice.
 *
 * Carries a live preview rather than just the three-option control. A theme
 * switch is one of the few settings whose effect is entirely visual, and the
 * settings page itself is mostly text — flipping the control there changes
 * almost nothing on screen, which reads as "did that do anything?". The
 * preview puts the surfaces that actually differ (a card, a pill button, a
 * segmented rail, an accent link, a muted caption) directly under the
 * control, so the choice is legible at the moment it is made.
 *
 * The preview is decorative: `aria-hidden`, non-interactive, and never
 * focusable, so it does not add a pile of fake controls to the tab order for
 * keyboard and screen-reader users.
 */
export function AppearanceSection() {
  const { preference, resolved, ready } = useTheme();

  const summary = !ready
    ? "Loading your preference…"
    : preference === "system"
      ? `Following your device — currently ${resolved}.`
      : `Always ${preference}, whatever your device is set to.`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">Appearance</span>
        <span className="text-xs text-foreground-subtle">{summary}</span>
      </div>

      <ThemeToggle />

      <div
        aria-hidden="true"
        className="flex flex-col gap-3 rounded-2xl border border-hairline-soft bg-surface-1 p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="kivo-tile h-9 w-9 rounded-xl">
              <Share2 className="relative h-4 w-4" strokeWidth={1.75} />
            </span>
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-foreground">Preview</span>
              <span className="text-[11px] text-foreground-subtle">Surfaces, lines and accent</span>
            </div>
          </div>
          <span className="flex items-center gap-1.5 rounded-full border border-hairline bg-surface-raised px-2.5 py-1 text-[11px] font-medium text-foreground-muted shadow-soft">
            <Heart className="h-3 w-3" strokeWidth={1.75} />
            Like
          </span>
        </div>

        <div className="kivo-segment w-fit">
          <span className="kivo-segment-item px-3 py-1 text-[11px] font-semibold" data-active="true">
            Social
          </span>
          <span
            className="kivo-segment-item px-3 py-1 text-[11px] font-semibold text-foreground-subtle"
            data-active="false"
          >
            People
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="kivo-gradient-prime flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold text-on-accent">
            <Check className="h-3 w-3" strokeWidth={2.5} />
            Primary
          </span>
          <span className="text-[11px] font-medium text-accent">Accent link</span>
          <span className="text-[11px] text-foreground-subtle">Muted caption</span>
        </div>
      </div>
    </div>
  );
}
