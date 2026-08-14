import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getOrCreateProfile } from "@/lib/profile";
import { isClerkConfigured } from "@/lib/clerk";

// Every route here renders differently for a guest vs a signed-in profile
// (and, for a signed-in user, per-user data), so nothing under (app) is safe
// to prerender or cache statically.
export const dynamic = "force-dynamic";

export default async function AppGroupLayout({ children }: { children: ReactNode }) {
  // Every route under (app) is guest-viewable by design: KIVO is browsable
  // signed out (scores, teams, players, leagues, social feed, predictions
  // list), and each individual page/action decides for itself whether it
  // needs a profile (see getOrCreateProfile() call sites — every one of them
  // already treats a null profile as "guest", not an error). This layout's
  // only job is to resolve WHO the visitor is, not to gate access — that's
  // deliberately different from src/app/admin/layout.tsx, which protects a
  // real privileged surface. See src/proxy.ts for why this can't live in
  // middleware either way.
  const profile = isClerkConfigured() ? await getOrCreateProfile() : null;

  // Only a signed-in user can be "mid-onboarding" — a guest has no profile
  // row to be incomplete, so this never fires for them.
  if (profile && !profile.onboarding_completed) {
    redirect("/onboarding");
  }

  return <AppShell signedIn={Boolean(profile)}>{children}</AppShell>;
}
