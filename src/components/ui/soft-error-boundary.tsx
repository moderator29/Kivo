"use client";

import { Component, type ReactNode } from "react";
import { logError } from "@/lib/log";

/**
 * A boundary for the parts of a page that are *enhancements*, not content.
 *
 * docs/BUG_AUDIT_2026-08-18.md C4: /social reached "Something went wrong"
 * with the server returning 200, because a live-update convenience — the
 * Supabase Realtime subscription behind the "New posts" pill — was built on a
 * hook that could throw during hydration. A whole page of readable posts was
 * replaced by an error screen over a feature that only saves the reader a
 * manual refresh. That trade is never worth making, whatever the specific
 * throw is (a missing NEXT_PUBLIC_SUPABASE_* env var in a Preview
 * deployment, a provider that isn't mounted, a future auth-layer change).
 *
 * So: wrap the enhancement, not the content. When a child throws, this
 * renders `fallback` (nothing, by default) and logs the failure through the
 * app's structured sink, and the rest of the page keeps working. React error
 * boundaries must be class components — that is a React requirement, not a
 * style choice.
 *
 * This is deliberately NOT a substitute for route-level error.tsx: use it
 * only where losing the subtree entirely is an acceptable outcome.
 */
export class SoftErrorBoundary extends Component<
  { context: string; children: ReactNode; fallback?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    logError(`softBoundary.${this.props.context}`, error);
  }

  render() {
    if (this.state.failed) return this.props.fallback ?? null;
    return this.props.children;
  }
}

/**
 * The boundary for a page's interactive *content*, as opposed to an
 * enhancement.
 *
 * KN-69. `(app)/error.tsx` catches a thrown render and replaces the whole
 * page: a crash inside `MatchCentreTabs` takes the score header, the nav
 * context and everything else with it. That is the wrong trade for a widget —
 * `MatchScoreDisplay` has already crashed the Match Centre once with a
 * re-render loop (BUILD_STATUS.md, 2026-08-17), and on that day the score
 * itself was fine.
 *
 * Different from `SoftErrorBoundary` above in one deliberate way: this one is
 * never silent. A missing enhancement needs no explanation; a missing tab
 * strip does, or the user is left staring at a gap wondering what they broke.
 * So it degrades to a visible, honest card — and offers a retry, because a
 * re-render loop and a transient data error look identical from here and one
 * of them really does recover.
 */
export class WidgetErrorBoundary extends Component<
  { context: string; label: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    logError(`widgetBoundary.${this.props.context}`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="status"
        className="kivo-glass flex flex-col items-start gap-2 rounded-2xl p-5 text-sm"
      >
        <p className="font-semibold text-foreground">{this.props.label} didn&apos;t load.</p>
        <p className="text-foreground-muted">
          The rest of this page is fine. Something went wrong rendering this section.
        </p>
        <button
          type="button"
          onClick={() => this.setState({ failed: false })}
          className="kivo-glass-sharp kivo-focus mt-1 rounded-xl px-3 py-1.5 text-xs font-semibold text-foreground"
        >
          Try again
        </button>
      </div>
    );
  }
}
