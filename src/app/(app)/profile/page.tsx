import type { Metadata } from "next";
import Link from "next/link";
import { CircleUserRound, ArrowRight, Star, Flame, Award, Target } from "lucide-react";
import { getOrCreateProfile } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { UsernameEditor } from "@/components/profile/username-editor";
import { FadeIn } from "@/components/ui/fade-in";
import { StatTile } from "@/components/home/stat-tile";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const profile = await getOrCreateProfile();

  if (!profile) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 px-6 py-24 text-center">
        <CircleUserRound className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
        <p className="text-sm text-foreground-muted">Sign up to set up your KIVO profile.</p>
        <Link
          href="/sign-up"
          className="kivo-gradient-prime rounded-xl px-5 py-2.5 text-sm font-semibold text-kivo-white transition-opacity hover:opacity-90"
        >
          Sign up
        </Link>
      </div>
    );
  }

  const supabase = createServerSupabaseClient();
  // Item 136: real content instead of a stub — XP total, badge progress and
  // prediction record, reusing the same RPC/queries /rewards and
  // /predictions/mine already use rather than rebuilding either page here.
  // Plain counts (head: true) since this is a summary tile, not a full list.
  const [
    { data: follows },
    { data: xpTotal },
    { count: totalBadgeCount },
    { count: earnedBadgeCount },
    { count: totalPredictionCount },
    { count: correctPredictionCount },
  ] = await Promise.all([
    supabase
      .from("follows")
      .select("followed_type")
      .eq("follower_profile_id", profile.id)
      .in("followed_type", ["team", "player", "competition"]),
    // Single aggregate round trip, same reasoning as /rewards and /home (see
    // get_xp_total in supabase/migrations/0023_xp_total_and_sync_run_pruning.sql).
    supabase.rpc("get_xp_total", { p_profile_id: profile.id }),
    supabase.from("badges").select("id", { count: "exact", head: true }),
    supabase.from("user_badges").select("id", { count: "exact", head: true }).eq("profile_id", profile.id),
    supabase.from("predictions").select("id", { count: "exact", head: true }).eq("profile_id", profile.id),
    // points_awarded is only set by the admin scoring pass — same "real
    // columns only" rule /predictions/mine's resultInfo() follows, not a
    // guessed outcome from the fixture score.
    supabase
      .from("predictions")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profile.id)
      .gt("points_awarded", 0),
  ]);

  const teamCount = (follows ?? []).filter((f) => f.followed_type === "team").length;
  const playerCount = (follows ?? []).filter((f) => f.followed_type === "player").length;
  const competitionCount = (follows ?? []).filter((f) => f.followed_type === "competition").length;
  const totalFollows = teamCount + playerCount + competitionCount;

  const totalXp = xpTotal ?? 0;
  const totalPredictions = totalPredictionCount ?? 0;
  const correctPredictions = correctPredictionCount ?? 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn className="kivo-glass flex items-center gap-4 rounded-2xl p-5">
        <div className="kivo-gradient-prime flex h-16 w-16 shrink-0 items-center justify-center rounded-full">
          <CircleUserRound className="h-8 w-8 text-kivo-white" strokeWidth={1.5} />
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold text-foreground">{profile.display_name || "Your profile"}</h1>
          <UsernameEditor username={profile.username} />
        </div>
      </FadeIn>

      <div className="grid grid-cols-3 gap-3">
        <StatTile
          href="/rewards"
          icon={<Flame className="h-4 w-4" strokeWidth={1.75} />}
          value={`${totalXp}`}
          label="XP"
          brand
          delay={0.05}
        />
        <StatTile
          href="/rewards"
          icon={<Award className="h-4 w-4" strokeWidth={1.75} />}
          value={`${earnedBadgeCount ?? 0}/${totalBadgeCount ?? 0}`}
          label="Badges"
          brand={false}
          delay={0.1}
        />
        <StatTile
          href="/predictions/mine"
          icon={<Target className="h-4 w-4" strokeWidth={1.75} />}
          value={totalPredictions > 0 ? `${correctPredictions}/${totalPredictions}` : "-"}
          label="Predictions"
          brand={false}
          delay={0.15}
        />
      </div>

      <FadeIn delay={0.2} className="kivo-glass rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
            <Star className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
            Following
          </h2>
          <Link
            href="/profile/following"
            className="flex items-center gap-1 text-xs font-medium text-kivo-cyan hover:text-kivo-cyan/80"
          >
            View all
            <ArrowRight className="h-3 w-3" strokeWidth={2} />
          </Link>
        </div>
        {totalFollows > 0 ? (
          <p className="mt-2 text-sm text-foreground-muted">
            {teamCount} {teamCount === 1 ? "team" : "teams"}, {playerCount} {playerCount === 1 ? "player" : "players"},{" "}
            {competitionCount} {competitionCount === 1 ? "competition" : "competitions"}.
          </p>
        ) : (
          <p className="mt-2 text-sm text-foreground-muted">
            You&apos;re not following any teams, players or competitions yet. Follow one from its page to see it
            here.
          </p>
        )}
      </FadeIn>
    </div>
  );
}
