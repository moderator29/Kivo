import { cache } from "react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Flame, Award, MapPin, Lock } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { logError } from "@/lib/log";
import { FadeIn } from "@/components/ui/fade-in";
import { FollowButton } from "@/components/ui/follow-button";
import { KivoAvatar } from "@/components/ui/kivo-avatar";
import { KivoProfileBackground } from "@/components/profile/kivo-profile-background";
import { resolveAvatarSrc } from "@/lib/kivo-assets";
import { getCountryName } from "@/lib/countries";
import { timeAgo } from "@/lib/format";
import { staggerDelay } from "@/lib/stagger";

type PublicProfile = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  avatar_type: "kivo" | "uploaded";
  avatar_kivo_id: string | null;
  avatar_uploaded_url: string | null;
  background_id: string | null;
  bio: string | null;
  country: string | null;
};

type PublicBadge = {
  code: string;
  name: string;
  description: string | null;
  icon_url: string | null;
  awarded_at: string;
};

/**
 * profiles has no cross-user SELECT policy (profiles_select_own,
 * profiles_select_admin) — a plain client query can never resolve
 * username -> profile for anyone but the caller's own row. Resolves through
 * the narrow SECURITY DEFINER RPC instead, same shape as get_public_profiles.
 *
 * Wrapped in React's `cache()` for the same reason getOrCreateProfile
 * (src/lib/profile.ts) and createServerSupabaseClient (src/lib/supabase/
 * server.ts) are: generateMetadata and the page component below each resolve
 * the same username in the same request, so without this every profile view
 * costs two identical round trips (and logged its failures twice).
 * `cache()` memoizes only within a single request, so nothing goes stale.
 *
 * "RPC errored" and "RPC returned no rows" are deliberately *not* collapsed
 * together. Returning null for both meant a transient database error rendered
 * "this profile doesn't exist" — a 404 that search engines and shared links
 * can cache — for a profile that does exist. A real failure throws so the
 * error boundary tells the visitor the truth ("try again"); only a genuinely
 * empty result becomes notFound().
 */
const getPublicProfile = cache(async function getPublicProfile(username: string): Promise<PublicProfile | null> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_public_profile_by_username", { p_username: username });
  if (error) {
    logError("profile.getPublicProfile", error, { username });
    throw new Error(`Could not resolve the profile for @${username}`, { cause: error });
  }
  const row = data?.[0];
  return row
    ? {
        id: row.id,
        username: row.username,
        display_name: row.display_name,
        avatar_url: row.avatar_url,
        avatar_type: row.avatar_type,
        avatar_kivo_id: row.avatar_kivo_id,
        avatar_uploaded_url: row.avatar_uploaded_url,
        background_id: row.background_id,
        bio: row.bio,
        country: row.country,
      }
    : null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const profile = await getPublicProfile(username);
  if (!profile) return { title: "Profile" };

  const name = profile.display_name || profile.username;
  const description = `${name} (@${profile.username}) on KIVO.`;
  return {
    title: name,
    description,
    openGraph: { title: name, description },
    twitter: { title: name, description },
  };
}

export default async function PublicProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const profile = await getPublicProfile(username);
  if (!profile) notFound();

  const supabase = createServerSupabaseClient();
  const [viewer, { data: statsRows }] = await Promise.all([
    getOrCreateProfile(),
    supabase.rpc("get_public_profile_stats", { p_profile_id: profile.id }),
  ]);

  const stats = statsRows?.[0] ?? null;
  // RECOMMENDATIONS.md item 286: get_public_profile_stats (migration 0048)
  // returns is_public = false with total_xp/badges already zeroed when the
  // profile owner has opted out via Settings — defaults true so a null/
  // missing row (shouldn't happen once a profile resolves, but defensive)
  // never accidentally renders the privacy-off state for an opted-in user.
  const isPublic = stats?.is_public ?? true;
  const totalXp = stats?.total_xp ?? 0;
  const badges = ((stats?.badges as PublicBadge[] | null) ?? []).slice().reverse();
  const isViewerOwnProfile = viewer?.id === profile.id;
  const displayName = profile.display_name || profile.username;

  // RECOMMENDATIONS item 175: real follow state for this specific user
  // target, feeding /social's Following tab. follows_select_own already
  // restricts this to the viewer's own row, so there's nothing to leak by
  // querying directly (no RPC needed, unlike profile identity above).
  const { data: followRow } = viewer && !isViewerOwnProfile
    ? await supabase
        .from("follows")
        .select("id")
        .eq("follower_profile_id", viewer.id)
        .eq("followed_type", "user")
        .eq("followed_id", profile.id)
        .maybeSingle()
    : { data: null };
  const isFollowingUser = Boolean(followRow);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <KivoProfileBackground backgroundId={profile.background_id}>
        <FadeIn className="kivo-glass flex items-center gap-4 rounded-2xl p-5">
          <KivoAvatar src={resolveAvatarSrc(profile)} name={displayName} size={64} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="truncate text-lg font-semibold text-foreground">{displayName}</h1>
            <span className="truncate text-sm text-foreground-subtle">@{profile.username}</span>
          </div>
          {isViewerOwnProfile ? (
            <Link
              href="/profile"
              className="shrink-0 rounded-xl border border-hairline px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:bg-surface-2"
            >
              Edit profile
            </Link>
          ) : (
            <FollowButton targetType="user" targetId={profile.id} initialFollowing={isFollowingUser} signedIn={Boolean(viewer)} size="sm" />
          )}
        </FadeIn>
      </KivoProfileBackground>

      {(profile.bio || profile.country) && (
        <FadeIn delay={0.03} className="kivo-glass flex flex-col gap-2 rounded-2xl p-5">
          {profile.bio && <p className="whitespace-pre-wrap text-sm text-foreground">{profile.bio}</p>}
          {profile.country && (
            <span className="flex items-center gap-1.5 text-xs text-foreground-subtle">
              <MapPin className="h-3 w-3 shrink-0" strokeWidth={2} />
              {getCountryName(profile.country)}
            </span>
          )}
        </FadeIn>
      )}

      {isPublic ? (
        <>
          <FadeIn delay={0.05} className="kivo-glass-brand flex items-center gap-4 rounded-2xl p-5">
            <div className="kivo-gradient-victory flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl">
              <Flame className="h-6 w-6 text-on-accent" strokeWidth={1.75} />
            </div>
            <div>
              <span className="text-2xl font-semibold text-foreground">{totalXp} XP</span>
              <p className="text-xs text-foreground-subtle">Earned across KIVO</p>
            </div>
          </FadeIn>

          <FadeIn delay={0.1} className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
              <Award className="h-4 w-4 text-accent" strokeWidth={1.75} />
              Badges
            </h2>

            {badges.length === 0 ? (
              <div className="kivo-glass rounded-2xl p-6 text-center text-sm text-foreground-muted">
                No badges earned yet.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {badges.map((badge, index) => (
                  <FadeIn key={badge.code} delay={0.12 + staggerDelay(index, 0.03)}>
                    <div className="kivo-glass flex flex-col items-center gap-2 rounded-2xl p-4 text-center ring-1 ring-inset ring-accent/25 transition hover:-translate-y-0.5">
                      {badge.icon_url && (
                        <Image
                          src={badge.icon_url}
                          alt=""
                          width={40}
                          height={40}
                          className="h-10 w-10 drop-shadow-[0_0_10px_var(--accent-hairline)]"
                        />
                      )}
                      <span className="text-xs font-semibold text-foreground">{badge.name}</span>
                      {badge.description && (
                        <span className="text-[11px] text-foreground-subtle">{badge.description}</span>
                      )}
                      <span className="text-[11px] text-foreground-subtle">{timeAgo(badge.awarded_at)}</span>
                    </div>
                  </FadeIn>
                ))}
              </div>
            )}
          </FadeIn>
        </>
      ) : (
        // RECOMMENDATIONS.md item 286: an honest privacy state, not a bare
        // zero — "0 XP earned" would misread as "hasn't earned anything" when
        // this profile's owner has simply opted out of showing it.
        <FadeIn delay={0.05} className="kivo-glass flex flex-col items-center gap-2 rounded-2xl p-8 text-center">
          <Lock className="h-6 w-6 text-foreground-subtle" strokeWidth={1.75} />
          <p className="text-sm text-foreground-muted">This user keeps their activity private.</p>
        </FadeIn>
      )}
    </div>
  );
}
