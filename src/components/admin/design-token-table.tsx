"use client";

import { useEffect, useState } from "react";
import type { TokenGroup } from "@/lib/design-system";

/**
 * Renders a token group as swatch + resolved value + rule.
 *
 * The resolved value is read off the live document with `getComputedStyle`
 * rather than repeated from a constant, which is the whole point of this page:
 * if a token loses its definition, drifts between themes, or is renamed in
 * `globals.css`, this table shows the real consequence (an empty swatch, a
 * value that no longer matches its neighbours) instead of a number someone
 * typed into a doc six weeks ago. It re-reads on `data-theme` changes so the
 * theme toggle in the top bar audits both palettes in one sitting.
 */
export function DesignTokenTable({ group }: { group: TokenGroup }) {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    const read = () => {
      const style = getComputedStyle(document.documentElement);
      const next: Record<string, string> = {};
      for (const token of group.tokens) {
        next[token.varName] = style.getPropertyValue(token.varName).trim();
      }
      setValues(next);
    };
    read();

    // The theme is applied by setting `data-theme` on <html> (see
    // src/components/theme/theme-provider.tsx), so that attribute is the one
    // reliable signal that every custom property just changed.
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [group]);

  return (
    <div className="kivo-glass overflow-hidden rounded-2xl">
      {group.tokens.map((token, index) => {
        const value = values[token.varName];
        return (
          <div
            key={token.varName}
            className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-4 ${
              index > 0 ? "border-t border-hairline-soft" : ""
            }`}
          >
            <div className="flex shrink-0 items-center gap-3">
              <span
                aria-hidden="true"
                className="h-10 w-10 shrink-0 rounded-lg border border-hairline-strong"
                style={{
                  // A checkerboard behind the swatch, because most surface and
                  // hairline tokens are deliberately translucent — painted on a
                  // flat fill they would all look identical.
                  backgroundColor: value || "transparent",
                  backgroundImage: value
                    ? undefined
                    : "repeating-linear-gradient(45deg, var(--hairline) 0 4px, transparent 4px 8px)",
                }}
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <code className="text-[13px] font-medium text-foreground">{token.varName}</code>
                <span className="tabular-nums text-[11px] text-foreground-subtle">
                  {value || "— not defined in this theme"}
                </span>
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="text-[13px] leading-relaxed text-foreground-muted">{token.rule}</p>
              {token.utility && (
                <code className="w-fit rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-foreground-subtle">
                  {token.utility}
                </code>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
