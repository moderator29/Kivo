"use client";

import Link from "next/link";
import { Sparkles, ArrowRight } from "lucide-react";
import { motion } from "motion/react";

/**
 * The AI Copilot teaser banner on Home. Client-side so the icon can breathe
 * with a gentle continuous pulse and a slow light sweep can pass through the
 * gradient, making the "next-gen" CTA feel alive rather than a static
 * banner. Both loops respect `prefers-reduced-motion` automatically via the
 * app-wide `<MotionConfig reducedMotion="user">`.
 */
export function AiTeaser({ aiConfigured }: { aiConfigured: boolean }) {
  return (
    <Link
      href="/ai"
      className="kivo-gradient-intelligence group relative flex items-center gap-3 overflow-hidden rounded-2xl p-4 kivo-raise focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent"
        animate={{ x: ["0%", "340%"] }}
        transition={{ duration: 3.5, repeat: Infinity, repeatDelay: 2.5, ease: "easeInOut" }}
      />
      <motion.span
        className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center"
        animate={{ scale: [1, 1.12, 1], opacity: [0.9, 1, 0.9] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      >
        <Sparkles className="h-5 w-5 text-on-accent" strokeWidth={1.75} />
      </motion.span>
      <p className="relative z-10 flex-1 text-sm font-medium text-on-accent">
        {aiConfigured
          ? "AI Copilot. Ask anything about your teams, players and matches."
          : "AI Copilot is coming. Grounded answers about your teams, players and matches."}
      </p>
      <ArrowRight className="relative z-10 h-4 w-4 shrink-0 text-on-accent/80 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
