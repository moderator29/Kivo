import { Ban, ShieldAlert } from "lucide-react";
import { effectiveModerationStatus, type ModerationStatus } from "@/lib/moderation";

export type ModerationStatusPanelProps = {
  status: ModerationStatus;
  reason: string | null;
  expiresAt: string | null;
};

/**
 * RECOMMENDATIONS.md item 288: `profile.moderation_status`/`_reason`/
 * `_expires_at` are already sitting in every server component's
 * already-fetched `profile` object (getOrCreateProfile()'s own `select("*")`)
 * — this is a read-only render of that, no new query. Complements, not
 * duplicates, the top-of-page ModerationBanner (item 234,
 * src/components/layout/moderation-banner.tsx): that one is transient page
 * chrome a suspended/banned user sees immediately on any page; this gives
 * the same real status/reason/expiry a stable, always-checkable home on
 * /settings, the same way the admin users table gives an admin a persistent
 * (not just a toast) view of the same three columns.
 *
 * Deliberately excludes shadow_muted, exactly like ModerationBanner already
 * does and for the identical reason its own comment states: shadow-mute is
 * designed to be zero-friction and invisible to the muted user themselves
 * (their own posts/comments look completely normal to them; only everyone
 * else can't see the new ones) — surfacing it here would defeat the entire
 * point of the tool, so this panel only ever renders for suspended/banned.
 *
 * Uses effectiveModerationStatus (the same lazy-expiry adjustment the admin
 * users table applies, see src/lib/moderation.ts) rather than the raw
 * column, so a suspension that has already technically elapsed doesn't keep
 * telling its own user they're restricted after the fact — the same honesty
 * standard this document applies everywhere else, applied to a user's own
 * account state.
 */
export function ModerationStatusPanel({ status, reason, expiresAt }: ModerationStatusPanelProps) {
  const effective = effectiveModerationStatus(status, expiresAt);
  if (effective !== "suspended" && effective !== "banned") return null;

  const isBanned = effective === "banned";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`kivo-glass flex flex-col gap-2 rounded-3xl border p-5 ${
        isBanned ? "border-critical/25 bg-critical/5" : "border-warning/25 bg-warning/5"
      }`}
    >
      <div className={`flex items-center gap-2 text-sm font-semibold ${isBanned ? "text-critical" : "text-warning"}`}>
        {isBanned ? (
          <Ban className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
        ) : (
          <ShieldAlert className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
        )}
        {isBanned ? "Account banned" : "Account suspended"}
      </div>
      <p className="text-sm text-foreground-muted">
        {reason && (
          <>
            Reason: <span className="text-foreground">&ldquo;{reason}&rdquo;</span>.{" "}
          </>
        )}
        Posting, commenting, reacting, predicting, rating, polling, saving and following are unavailable
        {isBanned ? "." : " until this lifts."}
      </p>
      <p className="text-xs text-foreground-subtle">
        {isBanned
          ? "This is permanent. Contact support if you believe it's a mistake."
          : expiresAt
            ? `Lifts automatically ${new Date(expiresAt).toLocaleString()}.`
            : "Lifts automatically once the suspension period ends."}
      </p>
    </div>
  );
}
