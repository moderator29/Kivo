"use client";

import { useSyncExternalStore } from "react";

/**
 * What KIVO actually knows about the connection.
 *
 * KN-79. `navigator.onLine` is binary and, worse, it is optimistic: it reports
 * `true` for a phone attached to a captive portal, a train tunnel with one
 * bar, and a server action that took thirty seconds and gave up. The far more
 * common mobile failure — "online, but nothing is getting through" — had no
 * affordance at all, and a server action that fails at the transport layer
 * *throws* in the client rather than returning the `{ error }` every call site
 * is written to handle, so it produced an unhandled rejection and a UI that
 * simply sat there.
 *
 * Three states, each earned by real evidence and never guessed:
 *   - `offline`     the browser itself says there is no connection.
 *   - `unreachable` we made a real request and it did not complete. This is
 *                   only ever set by an actual failure, never by a heuristic.
 *   - `online`      neither of the above.
 *
 * `unreachable` clears the moment any request succeeds, so it can never get
 * stuck telling a working app that it is broken.
 */
export type NetworkState = "online" | "offline" | "unreachable";

const listeners = new Set<() => void>();
let unreachable = false;

function emit() {
  listeners.forEach((listener) => listener());
}

/** Called when a request genuinely failed to complete. */
export function reportUnreachable() {
  if (unreachable) return;
  unreachable = true;
  emit();
}

/** Called when any request completes, whatever the server answered. */
export function reportReachable() {
  if (!unreachable) return;
  unreachable = false;
  emit();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (listeners.size === 1) {
    window.addEventListener("online", emit);
    window.addEventListener("offline", emit);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      window.removeEventListener("online", emit);
      window.removeEventListener("offline", emit);
    }
  };
}

function getSnapshot(): NetworkState {
  if (!navigator.onLine) return "offline";
  return unreachable ? "unreachable" : "online";
}

function getServerSnapshot(): NetworkState {
  // The server has no view of the client's connection, and assuming trouble
  // would render a warning banner into every initial HTML response.
  return "online";
}

export function useNetworkState(): NetworkState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** The copy shown for a failed call, so every call site says the same thing. */
export const UNREACHABLE_MESSAGE = "We couldn't reach KIVO. Check your connection and try again.";

/**
 * Calls a server action and turns a transport failure into the same
 * `{ error }` shape every KIVO action already returns.
 *
 * Without this, the two failure modes are wildly different at the call site: a
 * rejected mutation returns `{ error: "..." }` and renders a message, while a
 * dropped connection throws past the `await` and renders nothing at all — the
 * worse failure gets the quieter treatment. Here they converge, and the
 * transport case additionally lights the network banner, because "this one
 * button failed" and "you have no connection" deserve different volumes.
 */
export async function callAction<T extends { error: string | null }>(
  action: () => Promise<T>,
  fallback: Omit<T, "error">,
): Promise<T> {
  try {
    const result = await action();
    reportReachable();
    return result;
  } catch {
    // Deliberately not logged through logError: a user going through a tunnel
    // is not an application fault, and a feed full of them would drown the
    // real errors in the sink.
    reportUnreachable();
    return { ...fallback, error: UNREACHABLE_MESSAGE } as T;
  }
}
