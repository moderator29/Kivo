import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { getOrCreateProfile } from "@/lib/profile";

export default async function AppGroupLayout({ children }: { children: ReactNode }) {
  // Guarantees every authenticated route has a profile row to work with,
  // even if the Clerk webhook hasn't run yet — see lib/profile.ts.
  await getOrCreateProfile();

  return <AppShell>{children}</AppShell>;
}
