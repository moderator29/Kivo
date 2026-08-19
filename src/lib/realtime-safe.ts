import { logError } from "@/lib/log";

/**
 * Realtime is an enhancement. It must never be able to take a page down.
 *
 * `RealtimeClient.connect()` throws synchronously — `WebSocket not available:
 * <reason>` — when the socket cannot be opened at all. Every one of KIVO's
 * subscriptions is created inside a `useEffect`, and a throw there is not
 * caught by anything: React sends it straight to the nearest error boundary.
 * So a corporate proxy that blocks websockets, a browser extension, a captive
 * portal, a phone dropping to a network that forbids `wss://`, or the Realtime
 * service simply being down replaced the entire Match Centre with "Something
 * went wrong."
 *
 * That is the wrong trade by a wide margin. The page is server-rendered and
 * complete before any of this runs: the score, the timeline, the lineups and
 * every Room post are already on screen. All the subscription adds is that
 * they update without a refresh. Losing the socket should cost exactly that —
 * the reader keeps a correct, static page and refreshes it themselves — not
 * the page itself.
 *
 * Reported by the founder from a live phone: opening a Match Room showed the
 * error screen with `Error: WebSocket not available…` where the match and its
 * chat should have been.
 */

/**
 * Subscribe, and treat any failure to connect as "no live updates" rather than
 * an error. Returns a teardown that is always safe to call, including when the
 * subscribe never succeeded.
 *
 * `context` names the caller in the log so a genuine Realtime outage is still
 * diagnosable — silence in the UI must not mean silence in the logs.
 */
export function safeSubscribe<TChannel extends { subscribe: () => unknown }>(
  channel: TChannel,
  context: string,
  removeChannel: (channel: TChannel) => void,
): () => void {
  try {
    channel.subscribe();
  } catch (error) {
    logError(`realtime.${context}.subscribe`, error);
    // Still hand back a teardown that tries to release the channel: the client
    // registered it before connect() threw, so leaving it attached would leak
    // one per mount on a page the reader may open repeatedly.
    return () => safeRemoveChannel(channel, context, removeChannel);
  }

  return () => safeRemoveChannel(channel, context, removeChannel);
}

/** Teardown is on the unmount path, where a throw is even less excusable: it
 * happens while React is already tearing the tree down. */
function safeRemoveChannel<TChannel>(
  channel: TChannel,
  context: string,
  removeChannel: (channel: TChannel) => void,
): void {
  try {
    removeChannel(channel);
  } catch (error) {
    logError(`realtime.${context}.removeChannel`, error);
  }
}
