import type { ComponentProps } from "react";
import type { SignIn } from "@clerk/nextjs";

/**
 * Shared theming for every Clerk-rendered widget (sign-in, sign-up) so the
 * auth flow reads as part of KIVO rather than a stock Clerk widget dropped
 * onto a dark page. `variables` covers Clerk's own internal color/radius
 * tokens broadly; `elements` targets the handful of pieces that need KIVO's
 * actual CSS classes (the glass card, the gradient primary button) rather
 * than a color swap Clerk's variable system can't express. Typed off
 * SignIn's own `appearance` prop (SignUp's is structurally identical)
 * rather than importing `@clerk/types` directly, which isn't a direct
 * dependency of this project.
 */
export const kivoClerkAppearance: ComponentProps<typeof SignIn>["appearance"] = {
  variables: {
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
  elements: {
    card: "kivo-glass-brand shadow-none p-8",
    headerTitle: "text-foreground",
    headerSubtitle: "text-foreground-muted",
    socialButtonsBlockButton: "kivo-glass-sharp text-foreground hover:text-foreground",
    socialButtonsBlockButtonText: "text-foreground font-medium",
    dividerLine: "bg-white/10",
    dividerText: "text-foreground-subtle",
    formFieldLabel: "text-foreground-muted",
    formFieldInput: "kivo-glass-sharp text-foreground placeholder:text-foreground-subtle",
    formButtonPrimary: "kivo-gradient-prime text-kivo-white hover:opacity-90 shadow-none",
    footerActionText: "text-foreground-muted",
    footerActionLink: "text-kivo-cyan hover:text-kivo-cyan/80",
    identityPreviewText: "text-foreground",
    identityPreviewEditButton: "text-kivo-cyan",
    formResendCodeLink: "text-kivo-cyan",
    otpCodeFieldInput: "kivo-glass-sharp text-foreground",
    alertText: "text-critical",
    footer: "bg-transparent",
  },
};
