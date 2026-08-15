import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Flame, Award, History } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { FadeIn } from "@/components/ui/fade-in";
import { getNavItem } from "@/lib/navigation";
import { staggerDelay } from "@/lib/stagger";
import { timeAgo } from "@/lib/format";

const item = getNavItem("rewards");

export const metadata: Metadata = { title: item.label };

export default async function RewardsPage() {
  const profile = await getOrCreateProfile();
  if (!profile) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 px-6 py-24 text-center">
        <item.icon className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
        <p className="text-sm text-foreground-muted">Sign up to start earning XP and badges.</p>
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
  const [{ data: xpTotal }, { data: earnedBadges }, { data: allBadges }, { data: xpHistory }] = await Promise.all([
    // Single aggregate round trip instead of fetching every xp_ledger row
    // and summing in JS (RECOMMENDATIONS item 36) — see get_xp_total in
    // supabase/migrations/0023_xp_total_and_sync_run_pruning.sql.
    supabase.rpc("get_xp_total", { p_profile_id: profile.id }),
    supabase.from("user_badges").select("badge_id, awarded_at, badge:badges(code, name, description, icon_url)"),
    supabase.from("badges").select("id, code, name, description, icon_url").order("created_at", { ascending: true }),
    supabase.from("xp_ledger").select("amount, reason, created_at").order("created_at", { ascending: false }).limit(30),
  ]);

  const totalXp = xpTotal ?? 0;
  const earnedBadgeIds = new Set((earnedBadges ?? []).map((b) => b.badge_id));

  // Discrete count-up keyframes for the XP number: each step resets the
  // `kivo-xp-count` counter to the real running value, landing exactly on
  // totalXp at 100% every time. Capped step count keeps the generated CSS
  // small for large totals without changing the true final value. Pure CSS
  // (no client component needed) so this page can stay a Server Component
  // and fetch its own data directly, same reasoning as the transfers page's
  // inline keyframes and the landing page's kivo-aurora.
  const xpCountSteps = totalXp > 0 ? Math.min(totalXp, 40) : 0;
  const xpCountKeyframes =
    xpCountSteps > 0
      ? Array.from({ length: xpCountSteps + 1 }, (_, i) => {
          const percent = ((i / xpCountSteps) * 100).toFixed(2);
          const value = Math.round((totalXp * i) / xpCountSteps);
          return `${percent}% { counter-reset: kivo-xp-count ${value}; }`;
        }).join("\n")
      : "";

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
          {totalXp > 0 ? (
            <span className="text-2xl font-semibold text-foreground">
              {/* Real value, always in the DOM and correct even if the
                  counter animation below doesn't render for some reason
                  (no CSS support, reduced motion, etc). */}
              <style>{`
                @keyframes kivo-xp-count-up {
                  ${xpCountKeyframes}
                }
                .kivo-xp-count-up::before {
                  content: counter(kivo-xp-count);
                }
              `}</style>
              <span
                aria-hidden="true"
                className="kivo-xp-count-up inline-block animate-[kivo-xp-count-up_1.2s_cubic-bezier(0.22,1,0.36,1)_0.25s_forwards]"
              />
              <span className="sr-only">{totalXp}</span> XP
            </span>
          ) : (
            <span className="text-2xl font-semibold text-foreground">0 XP</span>
          )}
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
            {allBadges.map((badge, index) => {
              const earned = earnedBadgeIds.has(badge.id);
              return (
                <FadeIn key={badge.id} delay={0.12 + staggerDelay(index, 0.03)}>
                  <div
                    className={`kivo-glass flex flex-col items-center gap-2 rounded-2xl p-4 text-center ${
                      earned
                        ? "transition ring-1 ring-inset ring-kivo-cyan/25 hover:-translate-y-0.5"
                        : "opacity-40 grayscale"
                    }`}
                  >
                    {badge.icon_url && (
                      <Image
                        src={badge.icon_url}
                        alt=""
                        width={40}
                        height={40}
                        className={`h-10 w-10 ${earned ? "drop-shadow-[0_0_10px_rgba(0,217,255,0.35)]" : ""}`}
                      />
                    )}
                    <span className="text-xs font-semibold text-foreground">{badge.name}</span>
                    <span className="text-[11px] text-foreground-subtle">{badge.description}</span>
                    {!earned && (
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
                        Locked
                      </span>
                    )}
                  </div>
                </FadeIn>
              );
            })}
          </div>
        )}
      </FadeIn>

      <FadeIn delay={0.15} className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <History className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
          XP history
        </h2>

        {!xpHistory || xpHistory.length === 0 ? (
          <div className="kivo-glass rounded-2xl p-6 text-center text-sm text-foreground-muted">
            No XP earned yet. Complete onboarding or post in the community to get started.
          </div>
        ) : (
          <div className="kivo-glass flex flex-col divide-y divide-white/5 rounded-2xl">
            {xpHistory.map((entry, index) => (
              <div key={index} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-xs font-medium text-foreground">{entry.reason}</p>
                  <p className="text-[11px] text-foreground-subtle">{timeAgo(entry.created_at)}</p>
                </div>
                <span className="shrink-0 text-xs font-semibold text-live">+{entry.amount} XP</span>
              </div>
            ))}
          </div>
        )}
      </FadeIn>
    </div>
  );
}
