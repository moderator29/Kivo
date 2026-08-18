"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, LogOut } from "lucide-react";
import { signOutOtherDevices } from "@/app/(app)/session-actions";

/**
 * Replaces the Clerk-backed "Active sessions" panel that shipped on
 * 2026-08-17 (RECOMMENDATIONS.md item 289) and was removed with Clerk itself
 * on 2026-08-18.
 *
 * That panel listed each device's status, last-active time, IP-geolocated
 * city/country and browser/device, and let the user revoke any single one —
 * all of it real data straight from Clerk's session API. **Supabase Auth has
 * no equivalent**: sessions live in `auth.sessions`, a schema deliberately
 * not exposed through the API, and neither the client nor the admin SDK
 * offers a "list this user's sessions" or "revoke session by id" call. The
 * per-device list could therefore only have been rebuilt by inventing its
 * contents, so it was deleted rather than faked — see RECOMMENDATIONS.md item
 * 299, which tracks this as a real, open capability gap rather than a
 * finished feature.
 *
 * What remains here is the part Supabase genuinely supports: a single
 * `signOut({ scope: "others" })`, which really does terminate every other
 * session. The copy claims exactly that and no more — it does not name
 * devices, count them, or imply KIVO can see them.
 */
export function OtherDevicesSection() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSignOutOthers() {
    setError(null);
    setDone(false);
    startTransition(async () => {
      const result = await signOutOtherDevices();
      if (result.error) {
        setError(result.error);
        return;
      }
      setDone(true);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-foreground-muted">
        Signs you out of KIVO everywhere except this device. Use it if you&apos;ve signed in on a shared or lost device.
      </p>
      <p className="text-xs text-foreground-subtle">
        KIVO can&apos;t show you a list of your signed-in devices — Supabase Auth, which handles KIVO sign-in, doesn&apos;t
        expose one. Signing out other devices takes effect for good immediately, though a device that&apos;s already
        open can stay signed in for up to an hour before its current access token expires.
      </p>

      {error && (
        <p className="flex items-center gap-1.5 text-xs text-critical" role="status" aria-live="polite">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          {error}
        </p>
      )}

      {done && !error && (
        <p className="flex items-center gap-1.5 text-xs text-live" role="status" aria-live="polite">
          <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          Signed out of all other devices.
        </p>
      )}

      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={handleSignOutOthers}
        className="kivo-glass-sharp flex w-fit items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-foreground transition-transform active:scale-95 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <LogOut className="h-4 w-4" strokeWidth={1.75} />
        {pending ? "Signing out…" : "Sign out other devices"}
      </button>
    </div>
  );
}
