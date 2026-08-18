import { Ban, ShieldAlert } from "lucide-react";
import { LocalDateTime } from "@/components/ui/relative-time";

/**
 * RECOMMENDATIONS.md item 234: a suspended/banned user's own client must
 * show a clear, honest state rather than a confusing silent failure (every
 * write they attempt is really being rejected server-side by RLS — see
 * supabase/migrations/0045_moderation_status.sql — so without this they'd
 * just see posting/predicting/reacting mysteriously fail with no
 * explanation). Computed server-side in (app)/layout.tsx from the viewer's
 * own profile via effectiveModerationStatus() (src/lib/moderation.ts) — null
 * for `active`/`shadow_muted` (shadow-mute is deliberately zero-friction to
 * the muted user themselves), so this component only ever renders for a
 * real, current restriction on the real signed-in viewer.
 */
export type ModerationBannerInfo =
  | { kind: "suspended"; reason: string | null; expiresAt: string }
  | { kind: "banned"; reason: string | null };

export function ModerationBanner({ info }: { info: ModerationBannerInfo }) {
  const isBanned = info.kind === "banned";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`kivo-glass flex flex-col gap-1 rounded-none border-x-0 border-t-0 px-4 py-3 text-xs ${
        isBanned ? "border-b-critical/30 bg-critical/10" : "border-b-warning/30 bg-warning/10"
      }`}
    >
      <div className={`flex items-center gap-2 font-semibold ${isBanned ? "text-critical" : "text-warning"}`}>
        {isBanned ? (
          <Ban className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
        ) : (
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
        )}
        {isBanned ? "Your account has been banned." : <>Your account is suspended until <LocalDateTime iso={info.expiresAt} format="full" />.</>}
      </div>
      <p className="text-foreground-muted">
        {info.reason ? `Reason: ${info.reason}. ` : ""}
        Posting, commenting, reacting, predicting and other actions are disabled while this is in effect.
        {isBanned ? " This is permanent; contact support if you believe it's a mistake." : " It will lift automatically at the time above."}
      </p>
    </div>
  );
}
