import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { AppShell } from "@/components/layout/app-shell";
import { getOrCreateProfile } from "@/lib/profile";
import { isClerkConfigured } from "@/lib/clerk";

// Every route here is personalized and auth-gated; nothing under (app) is safe to
// prerender or cache statically. This also keeps the route dynamic even when the
// Clerk-unconfigured branch below takes the redirect() path without touching a
// Next.js dynamic API itself, which would otherwise let static analysis try to
// prerender it at build time.
export const dynamic = "force-dynamic";

export default async function AppGroupLayout({ children }: { children: ReactNode }) {
  // Resource-level auth boundary for every route under (app) — see src/proxy.ts for
  // why this can't be a middleware matcher. Unconfigured Clerk has no session to check,
  // so skip straight to the same redirect auth.protect() would otherwise perform.
  if (!isClerkConfigured()) {
    redirect("/sign-in");
  }
  await auth.protect();

  // Guarantees every authenticated route has a profile row to work with,
  // even if the Clerk webhook hasn't run yet — see lib/profile.ts.
  const profile = await getOrCreateProfile();

  // auth.protect() above already guarantees a signed-in user; a null profile here
  // means row creation itself failed (see lib/profile.ts), not a missing session.
  if (!profile) {
    redirect("/sign-in");
  }

  if (!profile.onboarding_completed) {
    redirect("/onboarding");
  }

  return <AppShell>{children}</AppShell>;
}
