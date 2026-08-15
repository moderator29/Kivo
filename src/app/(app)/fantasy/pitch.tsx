"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "motion/react";
import { UserRound } from "lucide-react";
import { formatFantasyPrice } from "./fantasy-rules";
import type { RosterEntry } from "./fantasy-builder";

export function StatTile({
  label,
  value,
  valueClass,
  caption,
}: {
  label: string;
  // ReactNode (not just string) so a tile's value can be an isolated leaf
  // component — see DeadlineCountdown (RECOMMENDATIONS item 83), which owns
  // its own re-render interval instead of the value being computed by, and
  // re-rendering, the parent on every tick.
  value: ReactNode;
  valueClass: string;
  caption?: string;
}) {
  return (
    <div className="kivo-glass flex flex-col gap-1 rounded-2xl p-3">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">{label}</span>
      <span className={`text-lg font-semibold tabular-nums ${valueClass}`}>{value}</span>
      {caption && <span className="text-[11px] leading-snug text-foreground-subtle">{caption}</span>}
    </div>
  );
}

export function PitchLines() {
  return (
    <svg
      className="pointer-events-none absolute inset-4 opacity-[0.07]"
      viewBox="0 0 100 140"
      preserveAspectRatio="none"
      aria-hidden
    >
      <rect x="1" y="1" width="98" height="138" fill="none" stroke="currentColor" strokeWidth="1" />
      <line x1="1" y1="70" x2="99" y2="70" stroke="currentColor" strokeWidth="1" />
      <circle cx="50" cy="70" r="16" fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x="20" y="1" width="60" height="20" fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x="20" y="119" width="60" height="20" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function PlayerToken({ player, onClick, compact = false }: { player: RosterEntry; onClick: () => void; compact?: boolean }) {
  const size = compact ? 40 : 48;
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className="group flex flex-col items-center gap-1 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
      style={{ width: compact ? 64 : 76 }}
    >
      <div className="relative">
        <div
          className="flex items-center justify-center rounded-full border border-white/10 bg-white/[0.06] transition group-hover:bg-white/10"
          style={{ width: size, height: size }}
        >
          <UserRound className="h-1/2 w-1/2 text-foreground-subtle" strokeWidth={1.75} />
        </div>
        {player.teamCrestUrl && (
          <div className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-kivo-obsidian ring-1 ring-white/10">
            {/* 12px crest render, never worth Next's optimizer round trip
                per club (RECOMMENDATIONS item 86) */}
            <Image src={player.teamCrestUrl} alt="" width={12} height={12} unoptimized className="object-contain" />
          </div>
        )}
        <AnimatePresence>
          {player.isCaptain && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 22 }}
              className="kivo-gradient-victory absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-kivo-white ring-2 ring-kivo-obsidian"
            >
              C
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {player.isViceCaptain && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 22 }}
              className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-achievement/40 bg-achievement/15 text-[10px] font-bold text-achievement ring-2 ring-kivo-obsidian"
            >
              V
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <span className="w-full truncate text-center text-[11px] font-medium text-foreground">{player.name}</span>
      <span className="text-[11px] font-semibold tabular-nums text-foreground-subtle">{formatFantasyPrice(player.price)}</span>
    </motion.button>
  );
}
