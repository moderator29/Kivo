"use client";

import Image from "next/image";
import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";

interface ComingSoonProps {
  icon: LucideIcon;
  /** 3D icon path from the sliced asset library — used in place of the vector
   * icon when a manifest icon unambiguously matches this feature. */
  image?: string;
  title: string;
  description: string;
}

export function ComingSoon({ icon: Icon, image, title, description }: ComingSoonProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="kivo-glass-brand flex w-full max-w-md flex-col items-center gap-7 rounded-3xl px-8 py-12"
      >
        <div className="relative flex h-32 w-32 items-center justify-center">
          <div
            className="kivo-gradient-intelligence absolute inset-2 rounded-full opacity-40 blur-2xl"
            aria-hidden="true"
          />
          {image ? (
            <Image
              src={image}
              alt=""
              width={112}
              height={112}
              className="relative h-28 w-28 drop-shadow-[0_8px_24px_rgba(0,217,255,0.25)]"
            />
          ) : (
            <div className="kivo-gradient-intelligence relative flex h-20 w-20 items-center justify-center rounded-2xl shadow-[0_8px_24px_rgba(37,99,255,0.35)]">
              <Icon className="h-9 w-9 text-kivo-white" strokeWidth={1.75} />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-kivo-cyan">Coming soon</span>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="max-w-sm text-sm leading-relaxed text-foreground-muted">{description}</p>
        </div>
      </motion.div>
    </div>
  );
}
