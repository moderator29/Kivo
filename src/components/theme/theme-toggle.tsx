"use client";

import { useRef } from "react";
import { motion } from "motion/react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { THEME_PREFERENCES, type ThemePreference } from "@/lib/theme";
import { useTheme } from "./theme-provider";

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun; hint: string }[] = [
  { value: "system", label: "System", Icon: Monitor, hint: "Follow your device setting" },
  { value: "light", label: "Light", Icon: Sun, hint: "Always light" },
  { value: "dark", label: "Dark", Icon: Moon, hint: "Always dark" },
];

/**
 * Segmented appearance control.
 *
 * Built as a real `radiogroup` rather than three buttons: a segmented control
 * is a single-choice input, and screen readers need to announce "2 of 3"
 * rather than three unrelated toggles. That brings the standard roving-
 * tabindex requirement with it — one tab stop for the whole group, arrow keys
 * to move between options — which is implemented below.
 *
 * The selected pill is a shared `layoutId` element, so switching options
 * slides it across rather than cutting. `<MotionConfig reducedMotion="user">`
 * in the root layout already downgrades that to an instant swap for anyone
 * who asked for reduced motion; nothing extra is needed here.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference, ready } = useTheme();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const back = event.key === "ArrowLeft" || event.key === "ArrowUp";
    if (!forward && !back) return;
    event.preventDefault();
    const next = (index + (forward ? 1 : -1) + OPTIONS.length) % OPTIONS.length;
    setPreference(OPTIONS[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className={cn("kivo-segment w-full max-w-xs", className)}
    >
      {OPTIONS.map((option, index) => {
        // Before hydration the stored preference is unknown, so nothing is
        // marked selected — rendering a guess here would flash the wrong
        // segment for anyone whose stored choice is not the default.
        const selected = ready && preference === option.value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${option.label} — ${option.hint}`}
            // Roving tabindex: only the selected option is in the tab order.
            // Falls back to the first option while the stored preference is
            // still unknown, so the group is never unreachable by keyboard.
            tabIndex={selected || (!ready && index === 0) ? 0 : -1}
            onClick={() => setPreference(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "kivo-focus relative flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
              selected ? "text-foreground" : "text-foreground-subtle hover:text-foreground",
            )}
          >
            {selected && (
              <motion.span
                layoutId="kivo-theme-toggle-pill"
                aria-hidden="true"
                className="absolute inset-0 rounded-full bg-surface-raised shadow-soft"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <option.Icon className="relative h-3.5 w-3.5" strokeWidth={2} />
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Icon-only variant for the top bar. Cycles system → light → dark → system.
 *
 * The icon always shows what is CURRENTLY painted (plus a dot when the
 * preference is "system"), not what the next press would do — a control that
 * previews its own next state is a well-known source of "I pressed the sun
 * and it went dark" confusion.
 */
export function ThemeToggleCompact({ className }: { className?: string }) {
  const { preference, resolved, setPreference, ready } = useTheme();

  const next: ThemePreference =
    THEME_PREFERENCES[(THEME_PREFERENCES.indexOf(preference) + 1) % THEME_PREFERENCES.length];

  const Icon = resolved === "light" ? Sun : Moon;
  const currentLabel = preference === "system" ? `System (${resolved})` : preference;

  return (
    <button
      type="button"
      onClick={() => setPreference(next)}
      // Not aria-pressed: this is a 3-state cycle, not a binary toggle, so the
      // accessible name carries the state instead.
      aria-label={`Appearance: ${currentLabel}. Switch to ${next}.`}
      title={`Appearance: ${currentLabel}`}
      className={cn(
        "kivo-focus relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-surface-2 hover:text-foreground",
        className,
      )}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
      {ready && preference === "system" && (
        <span
          aria-hidden="true"
          className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-accent"
        />
      )}
    </button>
  );
}
