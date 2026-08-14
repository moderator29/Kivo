import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { MotionConfig } from "motion/react";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const description =
  "KIVO is a premium football fan platform: live scores, an AI Copilot grounded in real data, match rooms, fantasy, and predictions. Built for football lovers.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "KIVO: Football. Together. Live.",
    template: "%s | KIVO",
  },
  description,
  openGraph: {
    title: "KIVO: Football. Together. Live.",
    description,
    type: "website",
    url: siteUrl,
    siteName: "KIVO",
    // Image itself comes from opengraph-image.tsx (file-based metadata takes
    // priority over this object per Next's docs), so no `images` entry here.
  },
  twitter: {
    card: "summary_large_image",
    title: "KIVO: Football. Together. Live.",
    description,
    // Same story as openGraph above — twitter-image.tsx supplies the image.
  },
};

// Matches the obsidian background (--kivo-obsidian in globals.css) so iOS
// Safari's chrome and Android's toolbar tint match the app instead of
// defaulting to white.
export const viewport: Viewport = {
  themeColor: "#05060a",
  colorScheme: "dark",
};

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export default function RootLayout({ children }: LayoutProps<"/">) {
  const body = (
    <html lang="en" className={`${jakarta.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </body>
    </html>
  );

  // ClerkProvider throws immediately without a publishable key — public pages
  // like the marketing landing page shouldn't depend on Clerk being configured.
  if (!clerkConfigured) return body;

  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "#2563ff",
          colorBackground: "#0d1630",
          colorForeground: "#f8faff",
          colorMutedForeground: "#cbd5e1",
          colorInput: "#05060a",
          colorInputForeground: "#f8faff",
          borderRadius: "0.75rem",
        },
      }}
    >
      {body}
    </ClerkProvider>
  );
}
