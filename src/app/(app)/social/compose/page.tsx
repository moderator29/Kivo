import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOrCreateProfile } from "@/lib/profile";
import { signInHref } from "@/lib/auth";
import { resolveAvatarSrc } from "@/lib/kivo-assets";
import { ComposeForm } from "@/components/social/compose-form";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "New post" };

/** A focus route (see src/lib/route-class.ts): no bottom bar, no top bar, one
 * way back — which lands you on the feed you came from, with your scroll. */
export default async function ComposePage() {
  const profile = await getOrCreateProfile();
  if (!profile) redirect(await signInHref());

  return (
    <div className="kivo-page flex-1">
      <PageHeader title="New post" description="Posts go to the KIVO community feed." />
      <ComposeForm avatarUrl={resolveAvatarSrc(profile)} username={profile.username} />
    </div>
  );
}
