import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOrCreateProfile } from "@/lib/profile";
import { signInHref } from "@/lib/auth";
import { isUuid } from "@/lib/params";
import { resolveAvatarSrc } from "@/lib/kivo-assets";
import { ComposeForm } from "@/components/social/compose-form";
import { PageHeader } from "@/components/layout/page-header";
import { fetchAttachableMatch, fetchAttachableMatches } from "./matches";

export const metadata: Metadata = { title: "New post" };

/** A focus route (see src/lib/route-class.ts): no bottom bar, no top bar, one
 * way back — which lands you on the feed you came from, with your scroll.
 *
 * `?match=<id>` pre-attaches a fixture, so a "post about this match" link from
 * anywhere in the app opens the composer with its subject already set. An id
 * that no longer names an open Room is ignored rather than errored — the fan
 * gets an ordinary composer, not a dead end. */
export default async function ComposePage({
  searchParams,
}: {
  searchParams: Promise<{ match?: string }>;
}) {
  const profile = await getOrCreateProfile();
  if (!profile) redirect(await signInHref());

  const { match: matchParam } = await searchParams;

  const [attachable, initialMatch] = await Promise.all([
    fetchAttachableMatches({ id: profile.id, favouriteTeamId: profile.favourite_team_id }),
    matchParam && isUuid(matchParam) ? fetchAttachableMatch(matchParam) : Promise.resolve(null),
  ]);

  return (
    <div className="kivo-page flex-1">
      <PageHeader title="New post" description="Posts go to the KIVO community feed." />
      <ComposeForm
        avatarUrl={resolveAvatarSrc(profile)}
        username={profile.username}
        matches={attachable.matches}
        matchesFailed={attachable.failed}
        initialMatch={initialMatch}
      />
    </div>
  );
}
