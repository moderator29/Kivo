"use client";

import { useState, useTransition } from "react";
import { Laptop, Smartphone, MapPin, LogOut, ShieldCheck, AlertTriangle } from "lucide-react";
import { revokeDeviceSession, type ActiveSessionInfo } from "@/app/(app)/settings/actions";
import { timeAgo } from "@/lib/format";

function describeDevice(session: ActiveSessionInfo): string {
  const parts = [session.browserName, session.deviceType].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" on ") : "Unknown device";
}

function describeLocation(session: ActiveSessionInfo): string {
  const parts = [session.city, session.country].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : "Unknown location";
}

/**
 * RECOMMENDATIONS.md item 289: real Clerk session data (never a fabricated
 * login-history feature) — status/location/browser/device all come straight
 * from clerkClient().sessions.getSessionList() via getActiveSessions
 * (settings/actions.ts). The row matching the viewer's own `auth()` session
 * id is marked "This device" and never shown a Sign out button, so nobody
 * can revoke the session they're currently using from this panel.
 */
export function ActiveSessionsPanel({
  initial,
  initialError,
}: {
  initial: ActiveSessionInfo[];
  initialError: string | null;
}) {
  const [sessions, setSessions] = useState(initial);
  const [error, setError] = useState(initialError);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleRevoke(sessionId: string) {
    setError(null);
    setRevokingId(sessionId);
    startTransition(async () => {
      const result = await revokeDeviceSession(sessionId);
      if (result.error) {
        setError(result.error);
        setRevokingId(null);
        return;
      }
      setSessions((current) => current.filter((session) => session.id !== sessionId));
      setRevokingId(null);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p className="flex items-center gap-1.5 text-xs text-critical" role="status" aria-live="polite">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          {error}
        </p>
      )}

      {sessions.length === 0 ? (
        !error && <p className="text-sm text-foreground-muted">No active sessions to show.</p>
      ) : (
        <div className="kivo-glass flex flex-col divide-y divide-white/5 rounded-2xl">
          {sessions.map((session) => {
            const DeviceIcon = session.isMobile ? Smartphone : Laptop;
            const isPending = revokingId === session.id;

            return (
              <div key={session.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/5">
                  <DeviceIcon className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-foreground">{describeDevice(session)}</span>
                    {session.isCurrentDevice && (
                      <span className="flex shrink-0 items-center gap-1 rounded-full bg-live/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-live">
                        <ShieldCheck className="h-2.5 w-2.5" strokeWidth={2.5} />
                        This device
                      </span>
                    )}
                  </div>
                  <span className="flex items-center gap-1 truncate text-[11px] text-foreground-subtle">
                    <MapPin className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                    {describeLocation(session)} · Active {timeAgo(session.lastActiveAt)}
                  </span>
                </div>
                {!session.isCurrentDevice && (
                  <button
                    type="button"
                    disabled={isPending}
                    aria-busy={isPending}
                    onClick={() => handleRevoke(session.id)}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-critical transition-colors hover:bg-critical/10 disabled:opacity-50"
                  >
                    <LogOut className="h-3.5 w-3.5" strokeWidth={2} />
                    {isPending ? "Signing out…" : "Sign out"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
