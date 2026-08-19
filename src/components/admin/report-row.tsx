"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { Check, X, Clock, FileQuestion, ExternalLink } from "lucide-react";
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

/**
 * The author's name, as a route to the only screen that can act on them.
 *
 * The consequence copy below is careful to say that resolving a report does not
 * remove content or restrict the author — "do that from Users." That sentence
 * was true and unactionable: Users listed the hundred most recently joined
 * accounts, so the author of a reported post from three months ago was not on
 * it, and there was no search. Both halves are fixed — Users takes a query now —
 * and this closes the loop by carrying the name into it.
 *
 * Rendered as plain text when the report has no author username, which happens
 * for a snapshot captured before that column existed. A link that lands on an
 * empty search is worse than a name.
 */
function AuthorLink({ username, display }: { username: string | null; display: string }) {
  if (!username) return <span>{display}</span>;
  return (
    <Link
      href={`/admin/users?q=${encodeURIComponent(username)}`}
      className="kivo-focusable inline-flex items-center gap-1 rounded text-foreground-muted underline decoration-hairline underline-offset-2 transition-colors hover:text-foreground"
      title={`Find @${username} in Users`}
    >
      {display}
      <ExternalLink className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden="true" />
    </Link>
  );
}

function ContentPreview({ preview }: { preview: ReportPreview }) {
  if (!preview) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-hairline bg-surface-1 px-3 py-2 text-xs text-foreground-subtle">
        <FileQuestion className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        Content no longer available.
      </div>
    );
  }

  const staleBadge = !preview.live && (
    <span className="shrink-0 rounded-full border border-hairline px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
      Deleted, from report snapshot
    </span>
  );

  if (preview.kind === "profile") {
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-hairline bg-surface-1 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-foreground-muted">
            <AuthorLink
              username={preview.username}
              display={preview.displayName ?? preview.username ?? "unknown profile"}
            />
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
    <div className="flex flex-col gap-1 rounded-lg border border-hairline bg-surface-1 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-foreground-muted">
          <AuthorLink
            username={preview.authorUsername}
            display={preview.authorDisplayName ?? preview.authorUsername ?? "unknown author"}
          />
        </span>
        {staleBadge}
      </div>
      <p className="text-xs text-foreground">{truncate(preview.body, PREVIEW_BODY_MAX_LENGTH)}</p>
    </div>
  );
}

/**
 * What each decision actually does, said before it is issued.
 *
 * "Mark actioned" reads like the moderator is doing something to the content.
 * It is not: resolving a report closes the report and writes two audit rows.
 * The post stays up, the comment stays up, the author keeps their account. A
 * moderator who believes otherwise leaves reported content live while the
 * queue tells them it was handled — and the queue is the only place they
 * would look.
 *
 * Removing content and restricting an account are separate, deliberate acts
 * on /admin/users. Naming that here is the difference between a tool that is
 * honest about its scope and one that quietly overstates it.
 */
const DECISION_CONSEQUENCE: Record<"actioned" | "dismissed", string> = {
  actioned:
    "Closes this report as upheld and records your decision in the audit trail. It does not remove the content or restrict the author — do that from Users.",
  dismissed: "Closes this report as no action needed. Nothing changes for the content or its author.",
};

function urgency(createdAt: string): { label: string; className: string } {
  const ageHours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
  if (ageHours >= 24) return { label: "Overdue", className: "border-critical/30 bg-critical/10 text-critical" };
  if (ageHours >= 6) return { label: "Aging", className: "border-warning/30 bg-warning/10 text-warning" };
  return { label: "New", className: "border-hairline text-foreground-subtle" };
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
            {resolved === "actioned" ? "Report upheld and logged" : "Report dismissed"}
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
            <p className="text-[11px] leading-relaxed text-foreground-muted">{DECISION_CONSEQUENCE[showNote]}</p>
          )}

          {showNote && (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note for the audit log"
                maxLength={500}
                className="h-11 w-full rounded-lg border border-hairline bg-surface-inset px-3 text-xs text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                type="button"
                onClick={() => {
                  setShowNote(null);
                  setNote("");
                }}
                className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 text-xs font-medium text-foreground-subtle transition hover:bg-surface-2 hover:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
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
              className="flex min-h-11 items-center gap-1 rounded-lg bg-live/15 px-3 text-xs font-semibold text-live transition hover:bg-live/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2} />
              {showNote === "actioned" ? "Confirm uphold" : "Uphold report"}
            </button>
            <button
              type="button"
              disabled={pending}
              aria-busy={pending}
              onClick={() => (showNote === "dismissed" ? handleDecision("dismissed") : setShowNote("dismissed"))}
              className="flex min-h-11 items-center gap-1 rounded-lg border border-hairline px-3 text-xs font-semibold text-foreground-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
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
