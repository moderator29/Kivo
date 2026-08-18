"use client";

import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { buildKivoClerkAppearance } from "@/lib/clerk-appearance";
import { useTheme } from "./theme-provider";

/**
 * ClerkProvider with KIVO's appearance recomputed whenever the theme changes.
 *
 * Clerk's widgets are rendered inside its own component tree with a palette it
 * derives from concrete color values, so they cannot pick the theme up from
 * CSS variables the way the rest of the app does — the appearance object has
 * to be handed to it per theme. That makes this a client component, which is
 * why it exists separately from the root layout rather than being inlined
 * there.
 *
 * Setting `appearance` once here means every Clerk surface — sign-in, sign-up,
 * the UserButton popover, OTP and MFA screens — is themed, including the ones
 * KIVO never renders explicitly and so could never have passed a prop to.
 */
export function ThemedClerkProvider({ children }: { children: ReactNode }) {
  const { resolved } = useTheme();
  return <ClerkProvider appearance={buildKivoClerkAppearance(resolved)}>{children}</ClerkProvider>;
}
