"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { Crown, Star, X, ArrowUpFromLine, ArrowDownToLine, SquareArrowOutUpRight, Trash2 } from "lucide-react";
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
          {/* Non-focusable backdrop (RECOMMENDATIONS.md item 149): a real
              `<button>` here sat in tab/reading order before the dialog's
              own content, so a screen reader user landed on an unlabelled
              "Close" control before hearing anything about the player it's
              actually about. The panel's own X button (below) is the real,
              announced close control. */}
          <div aria-hidden="true" className="absolute inset-0 bg-overlay backdrop-blur-sm" onClick={onClose} />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={`${player.name} actions`}
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            className="kivo-popover relative z-10 mx-3 mb-[calc(env(safe-area-inset-bottom)+16px)] flex flex-col gap-3 rounded-3xl p-4 pt-2.5"
          >
            <div aria-hidden="true" className="mx-auto h-1 w-9 shrink-0 rounded-full bg-hairline-strong" />

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
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-foreground-subtle transition hover:text-foreground"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <ActionRow
                icon={player.isStarting ? ArrowDownToLine : ArrowUpFromLine}
                label={player.isStarting ? "Move to bench" : "Move to starting XI"}
                disabled={locked}
                onClick={() => {
                  onToggleStarting();
                  onClose();
                }}
              />
              <ActionRow
                icon={Crown}
                label={player.isCaptain ? "Already captain" : "Make captain"}
                disabled={!isSaved || locked || pending || player.isCaptain || player.isViceCaptain}
                hint={!isSaved ? "Save your squad first" : player.isViceCaptain ? "Already vice-captain — change that first" : undefined}
                onClick={onMakeCaptain}
              />
              <ActionRow
                icon={Star}
                label={player.isViceCaptain ? "Already vice-captain" : "Make vice-captain"}
                disabled={!isSaved || locked || pending || player.isViceCaptain || player.isCaptain}
                hint={!isSaved ? "Save your squad first" : player.isCaptain ? "Already captain — change that first" : undefined}
                onClick={onMakeViceCaptain}
              />
              {/* KN-43: the builder renders real `players.id` values throughout
                  and /players/[id] is a rich page (form, transfers, photo, and
                  that player's real fantasy price and ownership), but a manager
                  picking a squad had no way to check who they were picking
                  without abandoning the flow. This sheet is already the "tell me
                  about this player" surface, so the route belongs here.

                  Opens in a new tab deliberately: an unsaved squad lives
                  entirely in FantasyBuilder's client state, so navigating away
                  in-place would silently discard every pick made since the last
                  save. A new tab is the only version of this link that cannot
                  cost the user their work. */}
              <ActionRow
                icon={SquareArrowOutUpRight}
                label="View player profile"
                hint="Opens in a new tab"
                href={`/players/${player.playerId}`}
              />
              <ActionRow icon={Trash2} label="Remove from squad" tone="critical" disabled={locked} onClick={onRemove} />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** One row of the sheet. Renders a real `<a>` when given an `href` and a
 * `<button>` otherwise, so a navigation and an action look identical without a
 * button pretending to be a link (which would lose middle-click, open-in-new-tab
 * and the browser's own affordances). */
function ActionRow({
  icon: Icon,
  label,
  hint,
  disabled,
  tone = "default",
  onClick,
  href,
}: {
  icon: typeof Crown;
  label: string;
  hint?: string;
  disabled?: boolean;
  tone?: "default" | "critical";
  onClick?: () => void;
  href?: string;
}) {
  const className = `flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 disabled:opacity-40 ${
    tone === "critical" ? "text-critical hover:bg-critical/10" : "text-foreground hover:bg-surface-2"
  }`;

  const content = (
    <>
      <span className="flex items-center gap-2.5">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
            tone === "critical" ? "bg-critical/10" : "bg-surface-2"
          }`}
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
        {label}
      </span>
      {hint && <span className="text-[11px] text-foreground-subtle">{hint}</span>}
    </>
  );

  if (href) {
    return (
      <Link href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {content}
      </Link>
    );
  }

  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={onClick}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={className}
    >
      {content}
    </motion.button>
  );
}
