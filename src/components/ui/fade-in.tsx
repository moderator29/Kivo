"use client";

import type { ReactNode } from "react";
import { motion, type HTMLMotionProps } from "motion/react";

type FadeInProps = {
  children: ReactNode;
  delay?: number;
} & Omit<HTMLMotionProps<"div">, "children" | "initial" | "animate" | "transition">;

// Extra DOM/ARIA props (role, id, aria-*, onKeyDown, tabIndex, …) pass
// straight through to the underlying motion.div — lets call sites attach
// tab/tabpanel semantics directly to a FadeIn wrapper instead of needing an
// extra non-animated element just to hold them.
export function FadeIn({ children, delay = 0, className, ...rest }: FadeInProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
