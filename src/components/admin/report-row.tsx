"use client";

import { useState, useTransition } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Check, X, Clock, FileQuestion } from "lucide-react";
import { resolveReport } from "@/app/admin/moderation/actions";

/**
 * Resolved reported content for the moderation queue (RECOMMENDATIONS.md
 * item 46). `live: true` means this came straight from the current row;
 * `live: false` means the target has already been deleted and this is the
 * `content_snapshot` captured at report-creation time (item 45). Both cases
 * only ever carry real values captured from a real row, never placeholders.
 */
export type ReportPreview =
  | {
      kind: "post" | "comment";
      body: string;
      authorUsername: string | null;
      authorDisplayName: string | null;
      live: boolean;
    }
  | {
      kind: "profile";
      username: string | null;
      displayName: string | null;
      bio: string | null;
      live: boolean;
    }
  | null;

type ReportRowProps = {
  id: string;
  targetType: string;
  reason: string;
  reporterUsername: string;
  createdAt: string;
  preview?: ReportPreview;
};

const PREVIEW_BODY_MAX_LENGTH = 240;

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function ContentPreview({ preview }: { preview: ReportPreview }) {
  if (!preview) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-foreground-subtle">
        <FileQuestion className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        Content no longer available.
      </div>
    );
  }

  const staleBadge = !preview.live && (
    <span className="shrink-0 rounded-full border border-white/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
      Deleted, from report snapshot
    </span>
  );

  if (preview.kind === "profile") {
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-foreground-muted">
            {preview.displayName ?? preview.username ?? "unknown profile"}
            {preview.username ? <span className="text-foreground-subtle"> @{preview.username}</span> : null}
          </span>
          {staleBadge}
        </div>
        {preview.bio ? (
          <p className="text-xs text-foreground">{truncate(preview.bio, PREVIEW_BODY_MAX_LENGTH)}</p>
        ) : (
          <p className="text-xs text-foreground-subtle">No bio.</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-foreground-muted">
          {preview.authorDisplayName ?? preview.authorUsername ?? "unknown author"}
          {preview.authorUsername ? <span className="text-foreground-subtle"> @{preview.authorUsername}</span> : null}
        </span>
        {staleBadge}
      </div>
      <p className="text-xs text-foreground">{truncate(preview.body, PREVIEW_BODY_MAX_LENGTH)}</p>
    </div>
  );
}

function urgency(createdAt: string): { label: string; className: string } {
  const ageHours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
  if (ageHours >= 24) return { label: "Overdue", className: "border-critical/30 bg-critical/10 text-critical" };
  if (ageHours >= 6) return { label: "Aging", className: "border-warning/30 bg-warning/10 text-warning" };
  return { label: "New", className: "border-white/10 text-foreground-subtle" };
}

export function ReportRow({ id, targetType, reason, reporterUsername, createdAt, preview = null }: ReportRowProps) {
  const [resolved, setResolved] = useState<"actioned" | "dismissed" | null>(null);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState<"actioned" | "dismissed" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const badge = urgency(createdAt);

  function handleDecision(decision: "actioned" | "dismissed") {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await resolveReport(id, decision, note);
      if (result.error) {
        setError(result.error);
        return;
      }
      setResolved(decision);
    });
  }

  return (
    <AnimatePresence mode="wait">
      {resolved ? (
        <motion.div
          key="resolved"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0, height: 0, marginBottom: 0 }}
          transition={{ duration: 0.35, delay: 0.4 }}
          className="overflow-hidden"
        >
          <div className="kivo-glass flex items-center gap-2 rounded-xl p-4 text-xs text-foreground-subtle">
            {resolved === "actioned" ? (
              <Check className="h-4 w-4 text-live" strokeWidth={1.75} />
            ) : (
              <X className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />
            )}
            Marked {resolved}
          </div>
        </motion.div>
      ) : (
        <motion.div
          key="open"
          layout
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="kivo-glass flex flex-col gap-3 rounded-xl p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-foreground">
                <span className="font-medium">{targetType}</span> reported by {reporterUsername}
              </p>
              <p className="text-xs text-foreground-muted">{reason}</p>
            </div>
            <span
              className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${badge.className}`}
            >
              <Clock className="h-3 w-3" strokeWidth={2} />
              {badge.label}
            </span>
          </div>

          <ContentPreview preview={preview} />

          {showNote && (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note for the audit log"
                maxLength={500}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-1 focus:ring-kivo-cyan"
              />
              <button
                type="button"
                onClick={() => {
                  setShowNote(null);
                  setNote("");
                }}
                className="shrink-0 rounded-lg px-2.5 py-2 text-xs font-medium text-foreground-subtle transition hover:bg-white/5 hover:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
              >
                Cancel
              </button>
            </div>
          )}

          {error && (
            <p className="text-xs text-critical" role="status" aria-live="polite">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              aria-busy={pending}
              onClick={() => (showNote === "actioned" ? handleDecision("actioned") : setShowNote("actioned"))}
              className="flex items-center gap-1 rounded-lg bg-live/15 px-3 py-1.5 text-xs font-semibold text-live transition hover:bg-live/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2} />
              {showNote === "actioned" ? "Confirm actioned" : "Mark actioned"}
            </button>
            <button
              type="button"
              disabled={pending}
              aria-busy={pending}
              onClick={() => (showNote === "dismissed" ? handleDecision("dismissed") : setShowNote("dismissed"))}
              className="flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-foreground-muted transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
              {showNote === "dismissed" ? "Confirm dismiss" : "Dismiss"}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
