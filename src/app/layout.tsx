import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { MotionConfig } from "motion/react";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "KIVO: Football. Together. Live.",
  description:
    "KIVO is a premium football fan platform: live scores, an AI Copilot grounded in real data, match rooms, fantasy, and predictions. Built for football lovers.",
};

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export default function RootLayout({ children }: LayoutProps<"/">) {
  const body = (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
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
