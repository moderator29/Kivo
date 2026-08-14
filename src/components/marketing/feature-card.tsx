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
      whileHover={{ y: -4 }}
      className="kivo-glass flex flex-col gap-3 rounded-2xl p-6 transition-shadow hover:shadow-[0_12px_40px_-12px_rgba(37,99,255,0.35)]"
    >
      <Image src={icon} alt="" width={48} height={48} className="h-12 w-12" />
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="text-sm leading-relaxed text-foreground-muted">{description}</p>
    </motion.div>
  );
}
