"use client";

import { useMemo, useState, useTransition } from "react";
import { Globe2 } from "lucide-react";
import { updateTimezone } from "@/app/(app)/settings/actions";
import { timeZoneOffsetLabel } from "@/lib/timezone";
import { useDeviceTimeZone, useSupportedTimeZones } from "@/lib/use-device-timezone";

/**
 * KN-89's honest source of truth for `profiles.timezone`.
 *
 * The whole design of this control is the answer to "where does the value come
 * from". KIVO does not geolocate. So the browser proposes — via
 * `Intl.DateTimeFormat().resolvedOptions().timeZone`, which is the device's own
 * setting, not an inference about the person — and the user confirms or picks
 * something else from the real IANA list. Until they do, nothing is stored and
 * the app says plainly that it is showing UTC.
 *
 * Detection runs in an effect rather than during render because the server has
 * no device zone to resolve: reading it during render would make the first
 * paint disagree with hydration for every visitor outside UTC, which is exactly
 * the class of bug src/lib/format.ts was written to end.
 */
export function TimezoneSection({ initialTimezone }: { initialTimezone: string | null }) {
  const [timezone, setTimezone] = useState<string | null>(initialTimezone);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Both read the platform rather than React state — see
  // src/lib/use-device-timezone.ts for why that is a `useSyncExternalStore`
  // and not an effect. On a browser without `Intl.supportedValuesOf` the
  // picker simply does not render, and the detected-zone button (which needs
  // no list) is still a complete path to setting a zone.
  const deviceTimezone = useDeviceTimeZone();
  const zoneOptions = useSupportedTimeZones();

  const offsetLabel = useMemo(() => (timezone ? timeZoneOffsetLabel(timezone) : null), [timezone]);
  const deviceOffsetLabel = useMemo(
    () => (deviceTimezone ? timeZoneOffsetLabel(deviceTimezone) : null),
    [deviceTimezone],
  );

  function save(next: string | null) {
    const previous = timezone;
    setError(null);
    setTimezone(next);

    startTransition(async () => {
      const result = await updateTimezone(next);
      if (result.error) {
        setTimezone(previous);
        setError(result.error);
      }
    });
  }

  const deviceMatchesStored = deviceTimezone !== null && deviceTimezone === timezone;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-sm text-foreground">
          <Globe2 className="h-3.5 w-3.5 text-foreground-subtle" strokeWidth={2} />
          Time zone
        </span>
        {timezone ? (
          <span className="text-xs text-foreground-subtle">
            Kickoffs, deadlines and daily totals use{" "}
            <span className="font-semibold text-foreground-muted">{timezone}</span>
            {offsetLabel ? ` (${offsetLabel})` : ""}.
          </span>
        ) : (
          <span className="text-xs text-foreground-subtle">
            Not set. KIVO shows times in UTC until you tell us your zone — it is never guessed from your location.
          </span>
        )}
      </div>

      {deviceTimezone && !deviceMatchesStored && (
        <button
          type="button"
          disabled={pending}
          onClick={() => save(deviceTimezone)}
          className="kivo-glass-sharp flex w-fit items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-foreground transition-transform active:scale-95 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          Use this device&apos;s zone — {deviceTimezone}
          {deviceOffsetLabel ? ` (${deviceOffsetLabel})` : ""}
        </button>
      )}

      {zoneOptions.length > 0 && (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-foreground-subtle">Or choose one</span>
          <select
            value={timezone ?? ""}
            disabled={pending}
            onChange={(event) => save(event.target.value === "" ? null : event.target.value)}
            className="kivo-glass-sharp w-full rounded-xl px-3 py-2 text-sm text-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <option value="">Not set (show times in UTC)</option>
            {zoneOptions.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && (
        <p className="text-xs text-critical" role="status" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}
