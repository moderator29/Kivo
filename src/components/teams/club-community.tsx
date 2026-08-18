import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fetchPostsPage } from "@/app/(app)/social/posts";
import { PostCard } from "@/components/social/post-card";

/**
 * A club's community, derived rather than declared (KN-102).
 *
 * RECOMMENDATIONS item 253 proposes `posts.team_id` plus a compose-time tag,
 * and marks it Large. This is the cheaper thing that is true today: a club's
 * conversation is already sitting in the Match Rooms of that club's fixtures.
 * No new column, no new user action, no migration — a join that already exists
 * through `posts.fixture_id`.
 *
 * That is also what makes this worth shipping *before* item 253 rather than
 * instead of it: it is the cheapest way to find out whether a club-scoped feed
 * is something people actually use, which is the question a schema change
 * should be answering before it is made.
 *
 * What it deliberately is not: posts by people who *support* this club. That is
 * a different feed — "Club mates" on `/social`, backed by
 * `get_team_feed_post_ids` (migration 0068) — and conflating the two would mean
 * a Chelsea fan's post about Arsenal appearing on the Arsenal page as though it
 * were an Arsenal fan's. This is posts *about* this club's matches, which the
 * fixture join can prove.
 */
const CLUB_FIXTURE_LOOKBACK = 60;
const CLUB_COMMUNITY_POSTS = 5;

export async function ClubCommunity({
  teamId,
  teamName,
  viewerProfileId,
}: {
  teamId: string;
  teamName: string;
  viewerProfileId: string | null;
}) {
  const supabase = createServerSupabaseClient();

  // Two bounded round trips rather than one clever one. A club plays a few
  // dozen matches a season, so the fixture list is small and knowable; doing it
  // this way keeps the query something anybody can read, and cannot silently
  // degrade the way an unbounded embedded filter would.
  const { data: fixtureRows } = await supabase
    .from("fixtures")
    .select("id")
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .order("kickoff_at", { ascending: false })
    .limit(CLUB_FIXTURE_LOOKBACK);

  const fixtureIds = (fixtureRows ?? []).map((row) => row.id);
  if (fixtureIds.length === 0) return null;

  const { data: postRows } = await supabase
    .from("posts")
    .select("id")
    .in("fixture_id", fixtureIds)
    // System-authored goal and red-card announcements are real, but they are
    // KIVO talking, not the community. A club's conversation should be people.
    .eq("is_system", false)
    .order("created_at", { ascending: false })
    .limit(CLUB_COMMUNITY_POSTS);

  const postIds = (postRows ?? []).map((row) => row.id);
  if (postIds.length === 0) return null;

  // Hydrated through exactly the same path every other post card takes, so a
  // club-community card and a /social card are the same card — reactions,
  // comment counts, polls and all.
  const { posts } = await fetchPostsPage(0, viewerProfileId, { postIds });
  if (posts.length === 0) return null;

  return (
    <FadeIn className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <MessagesSquare className="h-3.5 w-3.5" strokeWidth={2} />
          What {teamName} fans are saying
        </h2>
        <Link
          href="/social"
          className="text-xs text-foreground-subtle underline decoration-hairline-strong underline-offset-4 hover:text-foreground-muted"
        >
          All conversation
        </Link>
      </div>
      <p className="text-[11px] text-foreground-subtle">
        Posts from the Match Rooms of {teamName}&apos;s own fixtures — the conversation that already happened about
        this club&apos;s matches, not a separate feed.
      </p>
      <div className="flex flex-col gap-3">
        {posts.map((post, index) => (
          <PostCard key={post.id} {...post} signedIn={Boolean(viewerProfileId)} index={index} />
        ))}
      </div>
    </FadeIn>
  );
}
