import Image from "next/image";
import { Flame, Award } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { FadeIn } from "@/components/ui/fade-in";
import { ComingSoon } from "@/components/ui/coming-soon";
import { NAV_ITEMS } from "@/lib/navigation";

const item = NAV_ITEMS.find((i) => i.id === "rewards")!;

export default async function RewardsPage() {
  const profile = await getOrCreateProfile();
  if (!profile) {
    return (
      <ComingSoon icon={item.icon} image={item.comingSoonImage} title={item.label} description={item.comingSoonDescription!} />
    );
  }

  const supabase = createServerSupabaseClient();
  const [{ data: xpEntries }, { data: earnedBadges }, { data: allBadges }] = await Promise.all([
    supabase.from("xp_ledger").select("amount"),
    supabase.from("user_badges").select("badge_id, awarded_at, badge:badges(code, name, description, icon_url)"),
    supabase.from("badges").select("id, code, name, description, icon_url").order("created_at", { ascending: true }),
  ]);

  const totalXp = (xpEntries ?? []).reduce((sum, entry) => sum + entry.amount, 0);
  const earnedBadgeIds = new Set((earnedBadges ?? []).map((b) => b.badge_id));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn>
        <h1 className="text-xl font-semibold text-foreground">Rewards</h1>
        <p className="text-sm text-foreground-muted">XP and badges earned across KIVO.</p>
      </FadeIn>

      <FadeIn delay={0.05} className="kivo-glass-brand flex items-center gap-4 rounded-2xl p-5">
        <div className="kivo-gradient-victory flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl">
          <Flame className="h-6 w-6 text-kivo-white" strokeWidth={1.75} />
        </div>
        <div>
          <span className="text-2xl font-semibold text-foreground">{totalXp} XP</span>
          <p className="text-xs text-foreground-subtle">Earned from onboarding, posts and community activity</p>
        </div>
      </FadeIn>

      <FadeIn delay={0.1} className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <Award className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
          Badges
        </h2>

        {!allBadges || allBadges.length === 0 ? (
          <div className="kivo-glass rounded-2xl p-6 text-center text-sm text-foreground-muted">
            No badges available yet.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {allBadges.map((badge) => {
              const earned = earnedBadgeIds.has(badge.id);
              return (
                <div
                  key={badge.id}
                  className={`kivo-glass flex flex-col items-center gap-2 rounded-2xl p-4 text-center ${earned ? "" : "opacity-40"}`}
                >
                  {badge.icon_url && (
                    <Image src={badge.icon_url} alt="" width={40} height={40} className="h-10 w-10" />
                  )}
                  <span className="text-xs font-semibold text-foreground">{badge.name}</span>
                  <span className="text-[11px] text-foreground-subtle">{badge.description}</span>
                  {!earned && (
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-foreground-subtle">
                      Locked
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </FadeIn>
    </div>
  );
}
