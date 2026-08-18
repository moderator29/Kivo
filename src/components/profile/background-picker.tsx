"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "motion/react";
import { Check, X, Image as ImageIcon } from "lucide-react";
import { selectBackground, clearBackground } from "@/app/(app)/profile/background-actions";
import { KIVO_BACKGROUND_IDS, kivoBackgroundPath } from "@/lib/kivo-assets";

/**
 * The ten confirmed-clean KIVO backgrounds (RECOMMENDATIONS items 231/232)
 * as plain visual options, no id/number ever rendered. Most users won't
 * pick one at all — this never forces a selection, and "Remove background"
 * only shows once one is actually set.
 */
export function BackgroundPicker({ backgroundId }: { backgroundId: string | null }) {
  const [current, setCurrent] = useState(backgroundId);
  const [pending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  function flashSaved() {
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1600);
  }

  function handleSelect(id: string) {
    setError(null);
    setPendingId(id);
    startTransition(async () => {
      const result = await selectBackground(id);
      setPendingId(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      setCurrent(id);
      flashSaved();
    });
  }

  function handleClear() {
    setError(null);
    setPendingId("__clear__");
    startTransition(async () => {
      const result = await clearBackground();
      setPendingId(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      setCurrent(null);
      flashSaved();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-foreground-subtle">
          <ImageIcon className="h-3 w-3" strokeWidth={2} />
          Profile background
        </span>
        <div className="flex items-center gap-2">
          <AnimatePresence>
            {justSaved && (
              <motion.span
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="flex items-center gap-1 text-xs font-medium text-live"
              >
                <Check className="h-3 w-3" strokeWidth={2} />
                Saved
              </motion.span>
            )}
          </AnimatePresence>
          {current && (
            <button
              type="button"
              disabled={pending}
              onClick={handleClear}
              className="flex items-center gap-1 text-xs text-foreground-subtle transition hover:text-foreground-muted disabled:opacity-50"
            >
              <X className="h-3 w-3" strokeWidth={2} />
              Remove
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-5 gap-2">
        {KIVO_BACKGROUND_IDS.map((id) => {
          const isActive = current === id;
          const isThisPending = pending && pendingId === id;
          return (
            <button
              key={id}
              type="button"
              disabled={pending}
              onClick={() => handleSelect(id)}
              aria-label="Choose this KIVO background"
              aria-pressed={isActive}
              className={`relative aspect-video overflow-hidden rounded-xl ring-2 transition disabled:opacity-60 ${
                isActive ? "ring-accent" : "ring-transparent hover:ring-hairline-strong"
              }`}
            >
              <Image
                src={kivoBackgroundPath(id)}
                alt=""
                fill
                loading="lazy"
                sizes="(min-width: 640px) 100px, 20vw"
                className="object-cover"
              />
              {isActive && (
                <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent">
                  <Check className="h-2.5 w-2.5 text-on-accent" strokeWidth={2} />
                </span>
              )}
              {isThisPending && (
                <span className="absolute inset-0 flex items-center justify-center bg-overlay">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <span className="text-xs text-critical" role="status" aria-live="polite">
          {error}
        </span>
      )}
    </div>
  );
}
