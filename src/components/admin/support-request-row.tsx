"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Mail } from "lucide-react";
import { LocalDateTime } from "@/components/ui/relative-time";
import { updateSupportRequest } from "@/app/admin/support/actions";

export type SupportRequestView = {
  id: string;
  createdAt: string;
  replyEmail: string;
  topicLabel: string;
  message: string;
  status: "open" | "in_progress" | "closed";
  internalNote: string | null;
  handledAt: string | null;
};

const STATUS_STYLES: Record<SupportRequestView["status"], { label: string; className: string }> = {
  open: { label: "Open", className: "border-critical/40 bg-critical/10 text-critical" },
  in_progress: { label: "In progress", className: "border-accent/40 bg-accent/10 text-accent" },
  closed: { label: "Closed", className: "border-hairline bg-surface-1 text-foreground-subtle" },
};

/**
 * One inbound help request, with the two controls a person triaging actually
 * needs: change the status, and leave a note for whoever picks it up next.
 *
 * There is no "reply" button, and that is honest rather than unfinished: KIVO
 * has no transactional email of its own (ENVIRONMENT.md, KN-117), so a reply
 * genuinely is a human opening their own mail client. The address is therefore
 * rendered as a `mailto:` link — the real action, not a simulated one.
 */
export function SupportRequestRow({ request }: { request: SupportRequestView }) {
  const [note, setNote] = useState(request.internalNote ?? "");
  const [status, setStatus] = useState(request.status);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const badge = STATUS_STYLES[status];
  const dirty = note !== (request.internalNote ?? "") || status !== request.status;

  function save(nextStatus: SupportRequestView["status"]) {
    setError(null);
    setSaved(false);
    setStatus(nextStatus);
    startTransition(async () => {
      const result = await updateSupportRequest(request.id, nextStatus, note);
      if (result.error) {
        setError(result.error);
        setStatus(request.status);
        return;
      }
      setSaved(true);
    });
  }

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface-1 p-4">
      <header className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${badge.className}`}>
          {badge.label}
        </span>
        <span className="rounded-full border border-hairline px-2 py-0.5 text-[11px] font-medium text-foreground-muted">
          {request.topicLabel}
        </span>
        <span className="text-xs text-foreground-subtle">
          <LocalDateTime iso={request.createdAt} format="full" />
        </span>
      </header>

      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{request.message}</p>

      <a
        href={`mailto:${request.replyEmail}`}
        className="inline-flex w-fit items-center gap-1.5 rounded-full border border-hairline bg-surface-inset px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:text-foreground"
      >
        <Mail className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
        {request.replyEmail}
      </a>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-foreground-muted">Internal note</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={4000}
          placeholder="What you did, what's still outstanding. Never shown to the reporter."
          className="kivo-focusable w-full resize-y rounded-xl border border-hairline bg-surface-inset px-3 py-2 text-sm text-foreground transition-colors placeholder:text-foreground-subtle focus:border-accent focus:outline-none"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        {(["open", "in_progress", "closed"] as const).map((next) => (
          <button
            key={next}
            type="button"
            disabled={pending || (next === status && !dirty)}
            onClick={() => save(next)}
            className={`kivo-focusable rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              next === status
                ? "border-accent bg-accent/10 text-accent"
                : "border-hairline bg-surface-inset text-foreground-muted hover:text-foreground"
            }`}
          >
            {STATUS_STYLES[next].label}
          </button>
        ))}
        <AnimatePresence initial={false}>
          {error ? (
            <motion.span
              key="error"
              role="alert"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-xs text-critical"
            >
              {error}
            </motion.span>
          ) : saved ? (
            <motion.span
              key="saved"
              role="status"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-xs text-live"
            >
              Saved
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>
    </article>
  );
}
