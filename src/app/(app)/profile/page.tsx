import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { CircleUserRound, Pencil, MessageSquare, Target, Award, ArrowRight } from "lucide-react";
import { getOrCreateProfile } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ProfileHeader, type ProfileHeaderClub } from "@/components/profile/profile-header";
import { ProfileStatRail } from "@/components/profile/profile-stat-rail";
import { XpMomentum } from "@/components/profile/xp-momentum";
import { ProfileTabs, isProfileTab, type ProfileTab } from "@/components/profile/profile-tabs";
import { PostCard } from "@/components/social/post-card";
import { fetchPostsPage } from "@/app/(app)/social/posts";
import { TeamCrest } from "@/components/ui/team-crest";
import { FadeIn } from "@/components/ui/fade-in";
import { ShareCardPanel } from "@/components/share/share-card-panel";
import { resolveAvatarSrc, resolveBackgroundSrc } from "@/lib/kivo-assets";
import {
  PREDICTION_PICK_COLUMNS,
  PREDICTION_TYPE_LABEL,
  describePredictionPick,
  pickFromRow,
  predictionResultInfo,
} from "@/lib/predictions";
import { formatDateTime, timeAgo } from "@/lib/format";
import { staggerDelay } from "@/lib/stagger";
import { summariseXpWindows, xpWindowFloorIso } from "@/lib/xp-windows";

export const metadata: Metadata = { title: "Profile" };

/** How much of each tab's content the profile itself carries before handing
 * off to the dedicated page that owns it in full. A profile is a summary of a
 * person, not a second copy of `/social`, `/predictions/mine` or `/rewards`. */
const PROFILE_POST_LIMIT = 10;
const PROFILE_PREDICTION_LIMIT = 6;

/** A ceiling on the XP rows read for the momentum block. Two months of awards
 * for one person is a handful of rows; this exists so the query can never grow
 * unbounded, and the block is *dropped entirely* if it is ever hit, because a
 * truncated read would produce a sum that looks like a fact and is not. */
const XP_WINDOW_ROW_LIMIT = 1000;

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const profile = await getOrCreateProfile();

  if (!profile) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 px-6 py-24 text-center">
        <CircleUserRound className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
        <p className="text-sm text-foreground-muted">Sign up to set up your KIVO profile.</p>
        <Link
          href="/sign-up"
          className="kivo-gradient-prime rounded-xl px-5 py-2.5 text-sm font-semibold text-on-accent kivo-raise focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Sign up
        </Link>
      </div>
    );
  }

  const { tab: tabParam } = await searchParams;
  const tab: ProfileTab = isProfileTab(tabParam) ? tabParam : "posts";

  const supabase = createServerSupabaseClient();

  // One round of everything the header and rail need, regardless of tab —
  // these are the numbers that stay on screen while the tabs change under
  // them, so they are never re-fetched per tab.
  const [
    { data: follows },
    { data: followerRows },
    { data: xpTotal },
    { count: totalBadgeCount },
    { count: earnedBadgeCount },
    { count: savedCount },
    { data: club },
    { data: xpEntries },
  ] = await Promise.all([
    supabase.from("follows").select("followed_type").eq("follower_profile_id", profile.id),
    // `follows` has no cross-user SELECT policy — the reverse direction goes
    // through get_my_followers() (migration 0048), which is scoped to the
    // caller's own incoming follows only. Same call /profile/following makes.
    supabase.rpc("get_my_followers"),
    // Single aggregate round trip, same as /rewards and /home (get_xp_total,
    // supabase/migrations/0023_xp_total_and_sync_run_pruning.sql).
    supabase.rpc("get_xp_total", { p_profile_id: profile.id }),
    supabase.from("badges").select("id", { count: "exact", head: true }),
    supabase.from("user_badges").select("id", { count: "exact", head: true }).eq("profile_id", profile.id),
    // saves_select_own already scopes this to the caller's own rows.
    supabase.from("saves").select("id", { count: "exact", head: true }).eq("profile_id", profile.id),
    // The one club this profile supports. Read back by id rather than trusted
    // from the column alone, so a club deleted since it was picked renders as
    // "no club yet" instead of a dangling crest.
    profile.favourite_team_id
      ? supabase
          .from("teams")
          .select("id, name, short_name, crest_url")
          .eq("id", profile.favourite_team_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // The awards behind the lifetime total above, for the last two 30-day
    // windows. `xp_ledger_select_own` is the scope — a profile can only ever
    // read its own ledger, which is why this block exists on `/profile` and
    // could not exist on `/u/[username]`.
    supabase
      .from("xp_ledger")
      .select("amount, created_at")
      .eq("profile_id", profile.id)
      .gte("created_at", xpWindowFloorIso())
      .limit(XP_WINDOW_ROW_LIMIT + 1),
  ]);

  const xpRows = xpEntries ?? [];
  const xpWindows =
    xpRows.length > XP_WINDOW_ROW_LIMIT
      ? []
      : summariseXpWindows(
          xpRows.map((row) => ({ amount: row.amount, createdAt: row.created_at })),
          profile.created_at,
        );

  const followingCount = (follows ?? []).length;
  const followerCount = (followerRows ?? []).length;
  const headerClub: ProfileHeaderClub | null = club
    ? { id: club.id, name: club.name, shortName: club.short_name, crestUrl: club.crest_url }
    : null;

  return (
    <div className="kivo-page">
      <FadeIn>
        <ProfileHeader
          owner
          displayName={profile.display_name}
          username={profile.username}
          avatarSrc={resolveAvatarSrc(profile)}
          coverSrc={resolveBackgroundSrc(profile)}
          bio={profile.bio}
          country={profile.country}
          joinedAt={profile.created_at}
          club={headerClub}
          connections={{
            following: followingCount,
            followers: followerCount,
            followingHref: "/profile/following",
          }}
          action={
            <Link
              href="/profile/edit"
              className="kivo-glass-sharp kivo-focus flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
              Edit profile
            </Link>
          }
        />
      </FadeIn>

      {/* Only for someone who has actually earned something. A momentum card
          reading "+0 XP" above a lifetime total of 0 is a scoreboard for a
          game the reader has not started — the tabs below already say what to
          do about that, in words. */}
      {(xpTotal ?? 0) > 0 && xpWindows.length > 0 && (
        <FadeIn delay={0.03}>
          <XpMomentum windows={xpWindows} total={xpTotal ?? 0} />
        </FadeIn>
      )}

      <FadeIn delay={0.04}>
        <ProfileStatRail
          stats={[
            { href: "/rewards", value: `${xpTotal ?? 0}`, label: "XP" },
            { href: "/rewards", value: `${earnedBadgeCount ?? 0}/${totalBadgeCount ?? 0}`, label: "Badges" },
            { href: "/saved", value: `${savedCount ?? 0}`, label: "Saved" },
          ]}
        />
      </FadeIn>

      {/* KIVO_NEXT_GEN KN-98. The profile is a summary of a person; "Your
          season" is the narrative version of the same rows, and it needs a way
          in from here or it is a page nobody finds. */}
      <FadeIn delay={0.05}>
        <Link
          href="/profile/season"
          className="kivo-glass flex items-center justify-between gap-3 rounded-2xl px-4 py-3 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-foreground">Your season</span>
            <span className="text-xs text-foreground-subtle">
              Your record, streak, fantasy arc and badges — counted from your own activity only.
            </span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
        </Link>
      </FadeIn>

      <FadeIn delay={0.06} className="flex flex-col gap-4">
        <ProfileTabs active={tab} />
        {tab === "posts" && <PostsPanel profileId={profile.id} />}
        {tab === "predictions" && <PredictionsPanel profileId={profile.id} />}
        {tab === "badges" && <BadgesPanel profileId={profile.id} />}
      </FadeIn>

      <FadeIn delay={0.2} className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
        <ShareCardPanel
          kind="profile-achievement"
          id={profile.id}
          shareUrl={`/u/${profile.username}`}
          shareText={`${profile.display_name ?? profile.username} on KIVO.`}
          heading="Share your profile"
          description="Only what KIVO can actually count goes on the card. Pick a background."
        />
      </FadeIn>
    </div>
  );
}

/** Shared shape for a tab with nothing in it yet. Every one of these is a
 * genuine empty state — KIVO has no seeded content and never invents any — so
 * each says what would put something here rather than apologising. */
function EmptyPanel({
  icon,
  title,
  body,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="kivo-glass flex flex-col items-center gap-2 rounded-2xl px-6 py-10 text-center">
      <span className="text-foreground-subtle">{icon}</span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="max-w-xs text-xs leading-relaxed text-foreground-muted">{body}</p>
      {cta && (
        <Link
          href={cta.href}
          className="kivo-focus mt-1 flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-strong"
        >
          {cta.label}
          <ArrowRight className="h-3 w-3" strokeWidth={2} />
        </Link>
      )}
    </div>
  );
}

async function PostsPanel({ profileId }: { profileId: string }) {
  const supabase = createServerSupabaseClient();
  // Two steps rather than a new option on fetchPostsPage: `posts_select_public`
  // already scopes what this viewer may read, so the id list below is a real
  // authorization result, and hydrating it through the shared loader is what
  // keeps reactions, comment counts, polls and save state identical to how the
  // same post renders in /social.
  const { data: rows } = await supabase
    .from("posts")
    .select("id")
    .eq("author_profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(PROFILE_POST_LIMIT);

  const postIds = (rows ?? []).map((row) => row.id);
  const { posts } = await fetchPostsPage(0, profileId, { postIds });

  if (posts.length === 0) {
    return (
      <EmptyPanel
        icon={<MessageSquare className="h-6 w-6" strokeWidth={1.75} />}
        title="No posts yet"
        body="Anything you post in the feed or in a Match Room shows up here, newest first."
        cta={{ href: "/social", label: "Go to the feed" }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {posts.map((post, index) => (
        <PostCard key={post.id} {...post} signedIn index={index} />
      ))}
      {posts.length === PROFILE_POST_LIMIT && (
        <Link
          href="/social"
          className="kivo-focus flex items-center justify-center gap-1 py-1 text-xs font-semibold text-accent hover:text-accent-strong"
        >
          See more in the feed
          <ArrowRight className="h-3 w-3" strokeWidth={2} />
        </Link>
      )}
    </div>
  );
}

async function PredictionsPanel({ profileId }: { profileId: string }) {
  const supabase = createServerSupabaseClient();
  // `predictions_select_own` restricts this to the caller's own rows, so a
  // plain query is enough. The full record, streaks and per-competition
  // accuracy live on /predictions/mine — this is the recent slice plus a way
  // through to it, not a second copy of that page.
  const { data: rows, count } = await supabase
    .from("predictions")
    .select(
      `id, points_awarded, created_at, ${PREDICTION_PICK_COLUMNS},
       player:players!predictions_predicted_player_id_fkey(id, full_name, known_as),
       fixture:fixtures(
         id, kickoff_at, status, home_score, away_score,
         home_team:teams!fixtures_home_team_id_fkey(id, name, short_name, crest_url),
         away_team:teams!fixtures_away_team_id_fkey(id, name, short_name, crest_url)
       )`,
      { count: "exact" },
    )
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(PROFILE_PREDICTION_LIMIT);

  // fixture_id cascades on fixture delete, so this should not happen —
  // filtered defensively rather than rendering half a row.
  const predictions = (rows ?? []).filter((row) => row.fixture !== null);

  if (predictions.length === 0) {
    return (
      <EmptyPanel
        icon={<Target className="h-6 w-6" strokeWidth={1.75} />}
        title="No predictions yet"
        body="Call a result before kickoff and it lands here with what it earned once the match is scored."
        cta={{ href: "/predictions", label: "Make a prediction" }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {predictions.map((prediction, index) => {
        const fixture = prediction.fixture!;
        const result = predictionResultInfo(
          fixture.status,
          prediction.points_awarded,
          prediction.resolution,
          prediction.unresolvable_reason,
        );
        const ResultIcon = result.icon;
        return (
          <FadeIn
            key={prediction.id}
            delay={staggerDelay(index, 0.04)}
            className="kivo-glass flex items-center gap-3 rounded-2xl p-3.5"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <TeamCrest crestUrl={fixture.home_team?.crest_url ?? null} name={fixture.home_team?.name ?? null} size={20} />
                <span className="truncate text-xs font-medium text-foreground">
                  {fixture.home_team?.short_name || fixture.home_team?.name}
                </span>
                <span className="text-[11px] text-foreground-subtle">v</span>
                <TeamCrest crestUrl={fixture.away_team?.crest_url ?? null} name={fixture.away_team?.name ?? null} size={20} />
                <span className="truncate text-xs font-medium text-foreground">
                  {fixture.away_team?.short_name || fixture.away_team?.name}
                </span>
              </div>
              <span className="text-[11px] text-foreground-subtle">
                {PREDICTION_TYPE_LABEL[prediction.prediction_type]}:{" "}
                {describePredictionPick(
                  pickFromRow(prediction),
                  prediction.player?.known_as ?? prediction.player?.full_name ?? null,
                )}{" "}
                · {formatDateTime(fixture.kickoff_at, "dayTime", "UTC")}
              </span>
            </div>
            <span
              className={`flex shrink-0 items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 text-[11px] font-semibold ${result.className}`}
            >
              <ResultIcon className="h-3 w-3" strokeWidth={2} />
              {result.label}
            </span>
          </FadeIn>
        );
      })}
      {(count ?? 0) > predictions.length && (
        <Link
          href="/predictions/mine"
          className="kivo-focus flex items-center justify-center gap-1 py-1 text-xs font-semibold text-accent hover:text-accent-strong"
        >
          See your full record
          <ArrowRight className="h-3 w-3" strokeWidth={2} />
        </Link>
      )}
    </div>
  );
}

async function BadgesPanel({ profileId }: { profileId: string }) {
  const supabase = createServerSupabaseClient();
  const { data: earned } = await supabase
    .from("user_badges")
    .select("badge_id, awarded_at")
    .eq("profile_id", profileId)
    .order("awarded_at", { ascending: false });

  const badgeIds = (earned ?? []).map((row) => row.badge_id);
  // Same two-step lookup as exportUserData: resolve the small reference table
  // in a second query rather than relying on PostgREST's FK-embed syntax.
  const { data: badges } = badgeIds.length
    ? await supabase.from("badges").select("id, name, description, icon_url").in("id", badgeIds)
    : { data: [] as { id: string; name: string; description: string | null; icon_url: string | null }[] };
  const badgeById = new Map((badges ?? []).map((badge) => [badge.id, badge]));

  if (badgeIds.length === 0) {
    return (
      <EmptyPanel
        icon={<Award className="h-6 w-6" strokeWidth={1.75} />}
        title="No badges yet"
        body="Badges are earned, never bought — for streaks, predictions and taking part. The full list shows what each one takes."
        cta={{ href: "/rewards", label: "See every badge" }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {(earned ?? []).map((row, index) => {
          const badge = badgeById.get(row.badge_id);
          if (!badge) return null;
          return (
            <FadeIn
              key={row.badge_id}
              delay={staggerDelay(index, 0.03)}
              className="kivo-glass flex flex-col items-center gap-2 rounded-2xl p-4 text-center ring-1 ring-inset ring-accent/25"
            >
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
              <span className="text-[11px] leading-relaxed text-foreground-subtle">{badge.description}</span>
              <span className="text-[10px] font-medium text-accent">Earned {timeAgo(row.awarded_at)}</span>
            </FadeIn>
          );
        })}
      </div>
      <Link
        href="/rewards"
        className="kivo-focus flex items-center justify-center gap-1 py-1 text-xs font-semibold text-accent hover:text-accent-strong"
      >
        See every badge and what it takes
        <ArrowRight className="h-3 w-3" strokeWidth={2} />
      </Link>
    </div>
  );
}
