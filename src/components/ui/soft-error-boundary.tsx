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
