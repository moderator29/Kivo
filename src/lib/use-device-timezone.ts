"use client";

import { useSyncExternalStore } from "react";

/**
 * The device's own IANA timezone, or null on the server and anywhere the
 * runtime will not report one.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect` because that is
 * literally what this is: a read of an external system (the platform's
 * `Intl` settings) that the server cannot perform. It gives the correct
 * two-pass behaviour for free — `getServerSnapshot` returns null so SSR and
 * the first client render agree, and the real value arrives immediately after
 * hydration without a cascading setState. Nothing here ever changes during a
 * session, so `subscribe` has nothing to subscribe to.
 *
 * Never used to *infer* anything about the user: the value is always shown to
 * them and confirmed before it is stored (see `profiles.timezone`, migration
 * 0054, and KN-89's note on why IP geolocation is out of the question).
 */

let cachedZone: string | null | undefined;

function readDeviceTimeZone(): string | null {
  if (cachedZone === undefined) {
    try {
      cachedZone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
      cachedZone = null;
    }
  }
  return cachedZone;
}

let cachedZoneList: string[] | undefined;

function readSupportedTimeZones(): string[] {
  if (cachedZoneList === undefined) {
    try {
      // The runtime's own ICU zone list — no hand-maintained constant to drift
      // out of date as the IANA database changes. Absent on older browsers,
      // where callers fall back to offering only the detected zone.
      cachedZoneList = Intl.supportedValuesOf?.("timeZone") ?? [];
    } catch {
      cachedZoneList = [];
    }
  }
  return cachedZoneList;
}

const EMPTY_ZONE_LIST: string[] = [];

// Nothing to subscribe to: the platform's timezone does not change under a
// running page, so the store never notifies.
const subscribe = () => () => {};

export function useDeviceTimeZone(): string | null {
  return useSyncExternalStore(subscribe, readDeviceTimeZone, () => null);
}

export function useSupportedTimeZones(): string[] {
  // Both snapshots must be referentially stable across calls or React will
  // loop — hence the module-level caches above and the shared empty array.
  return useSyncExternalStore(subscribe, readSupportedTimeZones, () => EMPTY_ZONE_LIST);
}
