import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getOrCreateProfile } from "@/lib/profile";

export default async function AppGroupLayout({ children }: { children: ReactNode }) {
  // Guarantees every authenticated route has a profile row to work with,
  // even if the Clerk webhook hasn't run yet — see lib/profile.ts.
  const profile = await getOrCreateProfile();

  if (profile && !profile.onboarding_completed) {
    redirect("/onboarding");
  }

  return <AppShell>{children}</AppShell>;
}
