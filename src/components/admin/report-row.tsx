"use client";

import { useState, useTransition } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Check, X, Clock } from "lucide-react";
import { resolveReport } from "@/app/admin/moderation/actions";

type ReportRowProps = {
  id: string;
  targetType: string;
  reason: string;
  reporterUsername: string;
  createdAt: string;
};

function urgency(createdAt: string): { label: string; className: string } {
  const ageHours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
  if (ageHours >= 24) return { label: "Overdue", className: "border-critical/30 bg-critical/10 text-critical" };
  if (ageHours >= 6) return { label: "Aging", className: "border-warning/30 bg-warning/10 text-warning" };
  return { label: "New", className: "border-white/10 text-foreground-subtle" };
}

export function ReportRow({ id, targetType, reason, reporterUsername, createdAt }: ReportRowProps) {
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
              className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge.className}`}
            >
              <Clock className="h-3 w-3" strokeWidth={2} />
              {badge.label}
            </span>
          </div>

          {showNote && (
            <input
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note for the audit log"
              maxLength={500}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-1 focus:ring-kivo-cyan"
            />
          )}

          {error && <p className="text-xs text-critical">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => (showNote === "actioned" ? handleDecision("actioned") : setShowNote("actioned"))}
              className="flex items-center gap-1 rounded-lg bg-live/15 px-3 py-1.5 text-xs font-semibold text-live transition hover:bg-live/25 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2} />
              {showNote === "actioned" ? "Confirm actioned" : "Mark actioned"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => (showNote === "dismissed" ? handleDecision("dismissed") : setShowNote("dismissed"))}
              className="flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-foreground-muted transition hover:bg-white/5 disabled:opacity-50"
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
