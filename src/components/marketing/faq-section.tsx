"use client";

import { useId, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown } from "lucide-react";

const EASE = [0.22, 1, 0.36, 1] as const;

// Every answer below is checked against the real product, not written as
// marketing copy first: ARCHITECTURE.md's "What's real vs.
// architected-but-not-live", BUILD_STATUS.md, KIVO_BUILD_ACKNOWLEDGEMENT.md,
// and src/app/terms/page.tsx section 5 (the canonical no-gambling language
// this file's answer is paraphrased from, kept consistent with it rather
// than reworded independently). No stats, user counts, launch dates or
// coverage claims are invented anywhere here — if a fact isn't checkable
// against one of those sources, it isn't in this list.
const FAQS: { question: string; answer: string }[] = [
  {
    question: "What is KIVO?",
    answer:
      "KIVO is a football home: live scores and match intelligence, a social layer built around real matches (Match Rooms), an AI Copilot grounded in KIVO's own verified data, and fantasy and predictions, all in one place. It's built for how fans actually watch, argue and play, not a scores app with extras bolted on.",
  },
  {
    question: "Is KIVO free, and do I need an account?",
    answer:
      "Browsing is free and needs no account: scores, standings, teams, players, Match Centre and the AI Copilot's public answers are all open the moment you land. You're only asked to sign up, for free, the moment you want to act, like posting in a Match Room, submitting a prediction, or building a fantasy squad.",
  },
  {
    question: "What are Match Rooms?",
    answer:
      "Every fixture gets its own Match Room, a space scoped to that specific game inside Match Centre's Room tab, where fans post, comment and react while or after it happens. It's tied to the actual match, not a generic chatroom bolted on the side.",
  },
  {
    question: "What is the AI Copilot, and how is it “grounded”?",
    answer:
      "Ask it about a match, a player, or your team and it answers from KIVO's own synced data, not a guess. A disclosure panel shows exactly what it knew when it answered, and it says so plainly when the data isn't there yet instead of inventing a plausible-sounding answer.",
  },
  {
    question: "Is there any gambling or real-money betting on KIVO?",
    answer:
      "No. Predictions and fantasy on KIVO are free-to-play and for entertainment only, there's no real-money entry, wagering, or gambling of any kind. You earn XP and badges for correct picks and strong fantasy performance; they're in-app recognition with no cash value, not a payout.",
  },
  {
    question: "Where does KIVO's football data come from?",
    answer:
      "From real football data providers, synced into KIVO, never invented or estimated. If something hasn't synced yet, KIVO says so honestly instead of filling the gap with a plausible-looking number. The Transparency page shows exactly what's synced right now, down to the row count.",
  },
  {
    question: "What devices does KIVO work on?",
    answer:
      "KIVO is a responsive web app: open it in any modern browser, phone or desktop, and it's built for the device you're on rather than a shrunk-down desktop layout. No app store download needed.",
  },
];

/**
 * Landing-page FAQ: a single-open accordion (opening one answer closes any
 * other already open) so the section reads as a scannable list of
 * questions first, not a wall of pre-expanded text — restrained per the
 * founder's own brand direction ("motion communicates state, not
 * decoration", KIVO_BUILD_ACKNOWLEDGEMENT.md).
 *
 * `"use client"` is unavoidable here (open/close state, the height reveal),
 * but it's a small, isolated leaf with no server data of its own — page.tsx
 * around it stays a Server Component, same pattern as ScrollReveal
 * (src/components/ui/scroll-reveal.tsx).
 *
 * The open/close motion reuses the exact height/opacity/easing values
 * already shipping in CommentThread's own expand-collapse
 * (src/components/social/comment-thread.tsx) rather than inventing a new
 * timing, so this reads as the same motion language as the rest of the
 * app, not a one-off.
 */
export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const baseId = useId();

  return (
    <div className="kivo-glass flex flex-col divide-y divide-white/5 overflow-hidden rounded-3xl">
      {FAQS.map((item, index) => {
        const isOpen = openIndex === index;
        const questionId = `${baseId}-q-${index}`;
        const answerId = `${baseId}-a-${index}`;
        return (
          <div key={item.question} className="flex flex-col">
            <h3>
              <button
                type="button"
                id={questionId}
                aria-expanded={isOpen}
                aria-controls={answerId}
                onClick={() => setOpenIndex(isOpen ? null : index)}
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60 focus-visible:ring-inset"
              >
                <span className="text-sm font-semibold text-foreground sm:text-base">{item.question}</span>
                <ChevronDown
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className={`h-4 w-4 shrink-0 text-foreground-subtle transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                />
              </button>
            </h3>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  id={answerId}
                  role="region"
                  aria-labelledby={questionId}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25, ease: EASE }}
                  className="overflow-hidden"
                >
                  <p className="px-6 pb-5 text-sm leading-relaxed text-foreground-muted">{item.answer}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
