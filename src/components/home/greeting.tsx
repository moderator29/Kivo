"use client";

import { useSyncExternalStore } from "react";

/**
 * KN-33. `/home`'s greeting was `new Date().getHours()` inside a Server
 * Component, which on Vercel is UTC. A fan opening KIVO in Lagos at 08:00 was
 * told "Good evening" — a small thing that reads as the product not knowing
 * where it is, on the very first line of the very first screen after sign-in.
 *
 * Two sources, in this order, and the order is the whole design:
 *
 *   1. The timezone the user actually told us (`profiles.timezone`, migration
 *      0054). Server-rendered, correct on the first paint, no flash — and it
 *      follows the user to a borrowed laptop, which a device clock does not.
 *   2. Failing that, the browser's own clock, read after mount.
 *
 * The second half has to be a client component and it has to read the clock
 * AFTER hydration, never during render: the server has no way to know the
 * visitor's local hour, so computing it during SSR guarantees a hydration
 * mismatch for everyone outside UTC. `useSyncExternalStore` with a server
 * snapshot is the same pattern `LocalDateTime` already uses for exactly this
 * problem — it renders the server's answer first and swaps to the real one a
 * frame later, rather than guessing.
 *
 * When the user HAS stated a zone, `statedHour` is passed in and nothing
 * client-side runs at all.
 */
function subscribe() {
  return () => {};
}

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function Greeting({ statedHour }: { statedHour: number | null }) {
  // Server snapshot: whatever the server computed. For a user with a stated
  // timezone that is already right and this never changes. For everyone else it
  // is a provisional UTC-derived value, replaced on hydration.
  const hour = useSyncExternalStore(
    subscribe,
    () => (statedHour ?? new Date().getHours()),
    () => statedHour ?? 12,
  );

  return <p className="text-sm font-medium text-foreground-subtle">{greetingFor(hour)}</p>;
}
