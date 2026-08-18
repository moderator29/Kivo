import type { ComponentProps } from "react";
import type { SignIn } from "@clerk/nextjs";
import type { ResolvedTheme } from "@/lib/theme";

type ClerkAppearance = ComponentProps<typeof SignIn>["appearance"];

/**
 * Clerk's own color tokens, per theme.
 *
 * These are concrete values rather than `var(--foreground)` references on
 * purpose: Clerk derives hover/active/disabled shades from `colorPrimary` and
 * friends by parsing them, and a `var()` reference is opaque to that parser —
 * it would leave the derived states unstyled. So the palette is duplicated
 * here and kept in step with globals.css by hand.
 */
const VARIABLES: Record<ResolvedTheme, NonNullable<ClerkAppearance>["variables"]> = {
  dark: {
    colorPrimary: "#00d9ff",
    colorPrimaryForeground: "#f8faff",
    colorBackground: "transparent",
    colorForeground: "#f8faff",
    colorMutedForeground: "#cbd5e1",
    colorInput: "rgba(255, 255, 255, 0.04)",
    colorInputForeground: "#f8faff",
    colorDanger: "#ff3b4a",
    colorSuccess: "#22c55e",
    colorBorder: "rgba(255, 255, 255, 0.12)",
    borderRadius: "1.25rem",
    fontFamily: "inherit",
  },
  light: {
    // Deeper than the dark theme's cyan for the same reason the app's
    // --accent shifts: #00d9ff on a white card is ~1.4:1, so Clerk's links
    // and focus states would be unreadable.
    colorPrimary: "#1e50e6",
    colorPrimaryForeground: "#ffffff",
    colorBackground: "transparent",
    colorForeground: "#0b0e17",
    colorMutedForeground: "#4b5364",
    colorInput: "#f2f3f6",
    colorInputForeground: "#0b0e17",
    colorDanger: "#d91e2c",
    colorSuccess: "#0f9d52",
    colorBorder: "rgba(11, 14, 23, 0.12)",
    borderRadius: "1.25rem",
    fontFamily: "inherit",
  },
};

/**
 * Shared theming for every Clerk-rendered widget (sign-in, sign-up, the
 * UserButton menu) so the auth flow reads as part of KIVO rather than a stock
 * Clerk widget dropped onto the page. `variables` covers Clerk's own internal
 * color/radius tokens broadly; `elements` targets the handful of pieces that
 * need KIVO's actual CSS classes (the glass card, the gradient primary
 * button) rather than a color swap Clerk's variable system can't express.
 *
 * Every class named under `elements` is already theme-aware — they resolve
 * through the same tokens as the rest of the app — so only `variables` varies
 * by theme. Typed off SignIn's own `appearance` prop (SignUp's is
 * structurally identical) rather than importing `@clerk/types` directly,
 * which isn't a direct dependency of this project.
 *
 * Applied once at the provider level (see ThemedClerkProvider) so every Clerk
 * surface inherits it — individual pages no longer pass `appearance`
 * themselves, which previously meant the provider's copy and the page's copy
 * could disagree.
 */
export function buildKivoClerkAppearance(theme: ResolvedTheme): ClerkAppearance {
  return {
    variables: VARIABLES[theme],
    elements: {
      card: "kivo-glass-brand shadow-none p-8",
      headerTitle: "text-foreground",
      headerSubtitle: "text-foreground-muted",
      socialButtonsBlockButton: "kivo-glass-sharp text-foreground hover:text-foreground",
      socialButtonsBlockButtonText: "text-foreground font-medium",
      dividerLine: "bg-hairline",
      dividerText: "text-foreground-subtle",
      formFieldLabel: "text-foreground-muted",
      formFieldInput: "kivo-glass-sharp text-foreground placeholder:text-foreground-subtle",
      formButtonPrimary: "kivo-gradient-prime text-on-accent kivo-raise shadow-none",
      footerActionText: "text-foreground-muted",
      footerActionLink: "text-accent hover:text-accent/80",
      identityPreviewText: "text-foreground",
      identityPreviewEditButton: "text-accent",
      formResendCodeLink: "text-accent",
      otpCodeFieldInput: "kivo-glass-sharp text-foreground",
      alertText: "text-critical",
      footer: "bg-transparent",
    },
  };
}
