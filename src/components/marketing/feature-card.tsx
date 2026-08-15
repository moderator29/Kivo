"use client";

import Image from "next/image";
import { motion } from "motion/react";

export function FeatureCard({
  icon,
  title,
  description,
  index,
}: {
  icon: string;
  title: string;
  description: string;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.4, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -6, scale: 1.015 }}
      whileTap={{ scale: 0.99 }}
      className="group relative rounded-3xl"
    >
      {/* Ambient hover glow: a blurred, low-opacity brand-gradient halo that
          sits behind the card and brightens on hover. It's a decorative
          layer outside/behind the card, not a fill inside it, so the
          .kivo-glass-brand container below still reads as clean glass with
          only its usual thin gradient edge stroke. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-2 rounded-[1.75rem] opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-50"
        style={{ background: "linear-gradient(135deg, var(--kivo-cyan), var(--kivo-violet), var(--kivo-magenta))" }}
      />
      <div className="kivo-glass-brand relative flex flex-col gap-3 rounded-3xl p-6">
        <Image src={icon} alt="" width={56} height={56} className="h-14 w-14 object-contain" />
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className="text-sm leading-relaxed text-foreground-muted">{description}</p>
      </div>
    </motion.div>
  );
}
