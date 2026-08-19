"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Ban, EyeOff, ShieldCheck, TimerOff } from "lucide-react";
import {
  banUser,
  reinstateUser,
  shadowMuteUser,
  suspendUser,
  type SuspendDurationDays,
} from "@/app/admin/users/actions";
import type { Database } from "@/lib/supabase/types";
import { LocalDateTime } from "@/components/ui/relative-time";

type ModerationStatus = Database["public"]["Enums"]["moderation_status"];

type UserModerationControlsProps = {
  targetProfileId: string;
  targetUsername: string;
  /** Already lazy-expiry-adjusted by the caller (see effectiveModerationStatus
   * in admin/users/page.tsx) — this component never has to reason about
   * moderation_expires_at itself, it only renders whatever status it's given.
   * It is also what every action sends back as its expected-status guard, so
   * the server can refuse an action aimed at a state this screen never saw. */
  status: ModerationStatus;
  reason: string | null;
  expiresAt: string | null;
  /** Hides every action when true — an admin can't moderate their own
   * account (see requireModerationActor's doc comment in actions.ts); this
   * keeps the UI from offering a button that would just come back as an
   * error. */
  isViewerOwnRow: boolean;
};

const SUSPEND_DURATIONS: { days: SuspendDurationDays; label: string }[] = [
  { days: 1, label: "1 day" },
  { days: 3, label: "3 days" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
];

const STATUS_BADGE: Record<ModerationStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "border-white/10 text-foreground-subtle" },
  shadow_muted: { label: "Shadow-muted", className: "border-warning/30 bg-warning/10 text-warning" },
  suspended: { label: "Suspended", className: "border-warning/30 bg-warning/10 text-warning" },
  banned: { label: "Banned", className: "border-critical/30 bg-critical/10 text-critical" },
};

type Panel = "suspend" | "ban" | "shadow_mute" | "reinstate" | null;

const buttonBase =
  "inline-flex min-h-11 items-center justify-center rounded-lg border px-3 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60 disabled:opacity-50";

/**
 * What each action actually does, stated before it is issued.
 *
 * Every one of these is irreversible in the sense that matters: the person on
 * the other end is a real user who experiences it immediately. An admin tool
 * whose buttons are four verbs and no consequences asks a moderator to hold
 * the semantics of a graduated moderation system in their head, and the two
 * that are easiest to confuse — a shadow-mute the user is never told about,
 * and a suspension they are — differ mostly in whether the person knows.
 */
const CONSEQUENCE: Record<Exclude<Panel, null>, (username: string) => string> = {
  suspend: (u) =>
    `@${u} cannot post, comment or react until the suspension expires. They are shown the reason you write below.`,
  ban: (u) =>
    `@${u} is locked out of posting indefinitely. Nothing they have written is deleted, and this can be lifted later. They are shown the reason you write below.`,
  shadow_mute: (u) =>
    `@${u} keeps posting and still sees their own posts. Nobody else does. They are never told, and your note stays internal.`,
  reinstate: (u) => `Lifts @${u}'s current restriction immediately. Your note stays internal.`,
};

export function UserModerationControls({
  targetProfileId,
  targetUsername,
  status,
  reason,
  expiresAt,
  isViewerOwnRow,
}: UserModerationControlsProps) {
  const [liveStatus, setLiveStatus] = useState(status);
  const [liveReason, setLiveReason] = useState(reason);
  const [liveExpiresAt, setLiveExpiresAt] = useState(expiresAt);
  const [panel, setPanel] = useState<Panel>(null);
  const [durationDays, setDurationDays] = useState<SuspendDurationDays>(1);
  const [reasonDraft, setReasonDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (isViewerOwnRow) {
    return <span className="text-[11px] text-foreground-subtle">(your account)</span>;
  }

  function closePanel() {
    setPanel(null);
    setReasonDraft("");
    setError(null);
  }

  /** Every action follows the same shape: send the status this screen is
   * actually showing, and only touch local state once the server confirms. */
  function run(action: () => Promise<{ error: string | null }>, applyLocally: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setError(result.error);
        return;
      }
      applyLocally();
      closePanel();
    });
  }

  function runSuspend() {
    run(
      () => suspendUser(targetProfileId, durationDays, reasonDraft, liveStatus),
      () => {
        setLiveStatus("suspended");
        setLiveReason(reasonDraft.trim());
        setLiveExpiresAt(new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString());
      },
    );
  }

  function runBan() {
    run(
      () => banUser(targetProfileId, reasonDraft, liveStatus),
      () => {
        setLiveStatus("banned");
        setLiveReason(reasonDraft.trim());
        setLiveExpiresAt(null);
      },
    );
  }

  function runShadowMute() {
    run(
      () => shadowMuteUser(targetProfileId, reasonDraft, liveStatus),
      () => {
        setLiveStatus("shadow_muted");
        setLiveReason(null);
        setLiveExpiresAt(null);
      },
    );
  }

  function runReinstate() {
    run(
      () => reinstateUser(targetProfileId, reasonDraft, liveStatus),
      () => {
        setLiveStatus("active");
        setLiveReason(null);
        setLiveExpiresAt(null);
      },
    );
  }

  const badge = STATUS_BADGE[liveStatus];

  const panelConfig: Record<
    Exclude<Panel, null>,
    { confirmLabel: string; confirmClass: string; placeholder: string; run: () => void }
  > = {
    suspend: {
      confirmLabel: "Confirm suspend",
      confirmClass: "border-warning/30 bg-warning/15 text-warning hover:bg-warning/25",
      placeholder: `Reason for suspending @${targetUsername} (required, shown to them)`,
      run: runSuspend,
    },
    ban: {
      confirmLabel: "Confirm ban",
      confirmClass: "border-critical/30 bg-critical/15 text-critical hover:bg-critical/25",
      placeholder: `Reason for banning @${targetUsername} (required, shown to them)`,
      run: runBan,
    },
    shadow_mute: {
      confirmLabel: "Confirm shadow-mute",
      confirmClass: "border-white/10 bg-white/5 text-foreground-muted hover:bg-white/10",
      placeholder: `Internal note (required, never shown to @${targetUsername})`,
      run: runShadowMute,
    },
    reinstate: {
      confirmLabel: liveStatus === "shadow_muted" ? "Confirm un-mute" : "Confirm reinstate",
      confirmClass: "border-live/30 bg-live/15 text-live hover:bg-live/25",
      placeholder: `Internal note (required, never shown to @${targetUsername})`,
      run: runReinstate,
    },
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${badge.className}`}
        >
          {badge.label}
        </span>
        {liveStatus === "suspended" && liveExpiresAt && (
          <span className="text-[11px] text-foreground-subtle">
            until <LocalDateTime iso={liveExpiresAt} format="full" />
          </span>
        )}
      </div>

      {liveReason && (liveStatus === "suspended" || liveStatus === "banned") && (
        <p className="max-w-xs text-[11px] text-foreground-subtle">&ldquo;{liveReason}&rdquo;</p>
      )}

      {error && (
        <p className="flex items-start gap-1 text-[11px] text-critical" role="status" aria-live="polite">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2} />
          <span className="max-w-xs">{error}</span>
        </p>
      )}

      {panel ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] p-2">
          <p className="max-w-xs text-[11px] leading-relaxed text-foreground-muted">
            {CONSEQUENCE[panel](targetUsername)}
          </p>

          {panel === "suspend" && (
            <div className="flex flex-wrap gap-1">
              {SUSPEND_DURATIONS.map((d) => (
                <button
                  key={d.days}
                  type="button"
                  onClick={() => setDurationDays(d.days)}
                  className={`rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                    durationDays === d.days
                      ? "border-kivo-cyan/50 bg-kivo-cyan/15 text-foreground"
                      : "border-white/10 text-foreground-subtle hover:bg-white/5"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          )}

          <textarea
            autoFocus
            value={reasonDraft}
            onChange={(e) => setReasonDraft(e.target.value)}
            placeholder={panelConfig[panel].placeholder}
            maxLength={500}
            rows={2}
            className="min-h-11 w-full resize-none rounded-lg border border-white/10 bg-white/5 px-2.5 py-2.5 text-[11px] text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-1 focus:ring-kivo-cyan"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={pending}
              aria-busy={pending}
              onClick={panelConfig[panel].run}
              className={`${buttonBase} ${panelConfig[panel].confirmClass}`}
            >
              {panelConfig[panel].confirmLabel}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={closePanel}
              className={`${buttonBase} border-white/10 text-foreground-subtle hover:bg-white/5`}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {/* Suspend is deliberately not offered on a banned account: it would
              be a downgrade, and a moderator reaching for "Suspend" on a
              banned user has almost certainly not read the badge. The server
              refuses it too — this just stops the tool from proposing it. */}
          {liveStatus !== "suspended" && liveStatus !== "banned" && (
            <button type="button" disabled={pending} onClick={() => setPanel("suspend")} className={`${buttonBase} border-warning/30 text-warning hover:bg-warning/10`}>
              <TimerOff className="mr-1 inline h-3 w-3" strokeWidth={2} />
              Suspend
            </button>
          )}
          {liveStatus !== "banned" && (
            <button type="button" disabled={pending} onClick={() => setPanel("ban")} className={`${buttonBase} border-critical/30 text-critical hover:bg-critical/10`}>
              <Ban className="mr-1 inline h-3 w-3" strokeWidth={2} />
              Ban
            </button>
          )}
          {liveStatus === "active" && (
            <button type="button" disabled={pending} onClick={() => setPanel("shadow_mute")} className={`${buttonBase} border-white/10 text-foreground-muted hover:bg-white/5`}>
              <EyeOff className="mr-1 inline h-3 w-3" strokeWidth={2} />
              Shadow-mute
            </button>
          )}
          {liveStatus !== "active" && (
            <button type="button" disabled={pending} onClick={() => setPanel("reinstate")} className={`${buttonBase} border-live/30 text-live hover:bg-live/10`}>
              <ShieldCheck className="mr-1 inline h-3 w-3" strokeWidth={2} />
              {liveStatus === "shadow_muted" ? "Un-mute" : "Reinstate"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
