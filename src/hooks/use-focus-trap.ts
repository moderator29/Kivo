"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Real focus trap + Escape-to-close + focus restore for dialog/sheet-style
 * overlays. `aria-modal="true"` is a lie without this: without it, Tab past
 * the last focusable item lands on whatever's next in DOM order behind the
 * backdrop — still visually covered by the overlay but now receiving
 * keyboard interaction. Shared by every `role="dialog"` surface in the app
 * (mobile "more" nav sheet, notification panel, fantasy player action sheet
 * and player picker) so the trap/escape/restore behaviour stays identical
 * everywhere instead of being reimplemented per dialog.
 *
 * On open, focus moves to the first focusable element inside `panelRef`. On
 * close (including unmount), focus returns to `restoreFocusRef` if given,
 * otherwise to whatever element had focus right before the dialog opened.
 */
export function useFocusTrap(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  options?: { restoreFocusRef?: RefObject<HTMLElement | null> },
) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const restoreFocusRef = options?.restoreFocusRef;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const explicitRestoreTarget = restoreFocusRef?.current ?? null;
    const id = requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>("a, button, input")?.focus();
    });

    function focusableItems() {
      return Array.from(panelRef.current?.querySelectorAll<HTMLElement>("a, button, input") ?? []).filter(
        (el) => !el.hasAttribute("disabled"),
      );
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusableItems();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);

    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("keydown", onKeyDown);
      (explicitRestoreTarget ?? previouslyFocused)?.focus?.();
    };
  }, [open, panelRef, restoreFocusRef]);
}
