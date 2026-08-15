"use client";

import { useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Crown, Star, X, ArrowUpFromLine, ArrowDownToLine, Trash2 } from "lucide-react";
import { TeamCrest } from "@/components/ui/team-crest";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { formatFantasyPrice } from "./fantasy-rules";
import type { RosterEntry } from "./fantasy-builder";

export function PlayerActionSheet({
  player,
  isSaved,
  locked,
  pending,
  onClose,
  onToggleStarting,
  onRemove,
  onMakeCaptain,
  onMakeViceCaptain,
}: {
  player: RosterEntry | null;
  isSaved: boolean;
  locked: boolean;
  pending: boolean;
  onClose: () => void;
  onToggleStarting: () => void;
  onRemove: () => void;
  onMakeCaptain: () => void;
  onMakeViceCaptain: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(player !== null, panelRef, onClose);

  return (
    <AnimatePresence>
      {player && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-40 flex flex-col justify-end"
        >
          <button aria-label="Close" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={`${player.name} actions`}
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            className="kivo-glass relative z-10 mx-3 mb-[calc(env(safe-area-inset-bottom)+16px)] flex flex-col gap-3 rounded-2xl p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <TeamCrest crestUrl={player.teamCrestUrl} name={player.teamName ?? ""} size={28} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{player.name}</p>
                  <p className="truncate text-xs text-foreground-subtle">
                    {[player.position, player.teamName].filter(Boolean).join(" · ") || "-"} · {formatFantasyPrice(player.price)}
                  </p>
                </div>
              </div>
              <button type="button" onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-foreground-subtle transition hover:bg-white/5">
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <ActionRow
                icon={player.isStarting ? ArrowDownToLine : ArrowUpFromLine}
                label={player.isStarting ? "Move to bench" : "Move to starting XI"}
                onClick={() => {
                  onToggleStarting();
                  onClose();
                }}
              />
              <ActionRow
                icon={Crown}
                label={player.isCaptain ? "Already captain" : "Make captain"}
                disabled={!isSaved || locked || pending || player.isCaptain}
                hint={!isSaved ? "Save your squad first" : undefined}
                onClick={onMakeCaptain}
              />
              <ActionRow
                icon={Star}
                label={player.isViceCaptain ? "Already vice-captain" : "Make vice-captain"}
                disabled={!isSaved || locked || pending || player.isViceCaptain || player.isCaptain}
                hint={!isSaved ? "Save your squad first" : undefined}
                onClick={onMakeViceCaptain}
              />
              <ActionRow icon={Trash2} label="Remove from squad" tone="critical" onClick={onRemove} />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ActionRow({
  icon: Icon,
  label,
  hint,
  disabled,
  tone = "default",
  onClick,
}: {
  icon: typeof Crown;
  label: string;
  hint?: string;
  disabled?: boolean;
  tone?: "default" | "critical";
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={onClick}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-40 ${
        tone === "critical" ? "text-critical hover:bg-critical/10" : "text-foreground hover:bg-white/5"
      }`}
    >
      <span className="flex items-center gap-2.5">
        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        {label}
      </span>
      {hint && <span className="text-[10px] text-foreground-subtle">{hint}</span>}
    </motion.button>
  );
}
