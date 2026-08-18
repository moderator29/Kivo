import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Flame, Zap, Award, History, Trophy } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { FadeIn } from "@/components/ui/fade-in";
import { getNavItem } from "@/lib/navigation";
import { staggerDelay } from "@/lib/stagger";
import { timeAgo } from "@/lib/format";
import { buildWeekStrip, getStreakTier, mondayOfWeekUtc } from "@/lib/streak";

const item = getNavItem("rewards");

export const metadata: Metadata = { title: item.label };

type XpHistoryEntry = { amount: number; reason: string; created_at: string };
type XpHistoryLine = { key: string; amount: number; reason: string; created_at: string; count: number };

/** Collapses consecutive rows within a day that share the same amount and
 * reason into one line with a count (item 236: a dozen "+2 XP — Posted in
 * the community" rows in one day used to render as a dozen separate lines).
 * Only *consecutive* runs collapse — entries are already newest-first, so
 * this never merges e.g. two "Posted in the community" rows that happen to
 * sandwich a different reason, which would misrepresent the real order of
 * events. `created_at` on the collapsed line is the run's most recent
 * timestamp (the first one seen, since the input is newest-first), so the
 * displayed "time ago" still reflects the latest occurrence. */
function collapseConsecutiveXpEntries(entries: XpHistoryEntry[]): XpHistoryLine[] {
  const lines: XpHistoryLine[] = [];
  for (const entry of entries) {
    const last = lines[lines.length - 1];
    if (last && last.amount === entry.amount && last.reason === entry.reason) {
      last.count += 1;
    } else {
      lines.push({ key: entry.created_at, amount: entry.amount, reason: entry.reason, created_at: entry.created_at, count: 1 });
    }
  }
  return lines;
}

/** Groups XP history rows (already newest-first from the query) into
 * same-day buckets labeled "Today"/"Yesterday"/a short date, using the same
 * UTC day boundary as the streak section on this page so "Today" here always
 * means the same calendar day as the week strip's today pill. */
function groupXpHistoryByDay(
  entries: XpHistoryEntry[],
  todayUtc: Date,
): { label: string; entries: XpHistoryEntry[] }[] {
  const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);
  const todayIso = toIsoDate(todayUtc);
  const yesterdayUtc = new Date(todayUtc);
  yesterdayUtc.setUTCDate(yesterdayUtc.getUTCDate() - 1);
  const yesterdayIso = toIsoDate(yesterdayUtc);

  const groups: { label: string; entries: XpHistoryEntry[] }[] = [];
  for (const entry of entries) {
    const entryDate = new Date(entry.created_at);
    const entryIso = toIsoDate(entryDate);
    const label =
      entryIso === todayIso
        ? "Today"
        : entryIso === yesterdayIso
          ? "Yesterday"
          : entryDate.toLocaleDateString(undefined, { day: "numeric", month: "short" });
    const currentGroup = groups[groups.length - 1];
    if (currentGroup && currentGroup.label === label) {
      currentGroup.entries.push(entry);
    } else {
      groups.push({ label, entries: [entry] });
    }
  }
  return groups;
}

export default async function RewardsPage() {
  const profile = await getOrCreateProfile();
  if (!profile) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 px-6 py-24 text-center">
        <item.icon className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
        <p className="text-sm text-foreground-muted">Sign up to start earning XP and badges.</p>
        <Link
          href="/sign-up"
          className="kivo-gradient-prime rounded-xl px-5 py-2.5 text-sm font-semibold text-on-accent kivo-raise focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Sign up
        </Link>
      </div>
    );
  }

  const supabase = createServerSupabaseClient();

  // "Today" and "this week" in UTC — see get_activity_streak() in
  // supabase/migrations/0037_activity_streak.sql for why UTC is the day
  // boundary (profiles has no timezone column) and streak.ts's
  // mondayOfWeekUtc for why the page and the week strip must agree on
  // exactly the same Monday.
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const weekStartUtc = mondayOfWeekUtc(todayUtc);

  const [{ data: xpTotal }, { data: earnedBadges }, { data: allBadges }, { data: xpHistory }, { data: streak }, { data: weekXp }] =
    await Promise.all([
      // Single aggregate round trip instead of fetching every xp_ledger row
      // and summing in JS (RECOMMENDATIONS item 36) — see get_xp_total in
      // supabase/migrations/0023_xp_total_and_sync_run_pruning.sql.
      supabase.rpc("get_xp_total", { p_profile_id: profile.id }),
      supabase.from("user_badges").select("badge_id, awarded_at"),
      supabase.from("badges").select("id, code, name, description, icon_url").order("created_at", { ascending: true }),
      supabase.from("xp_ledger").select("amount, reason, created_at").order("created_at", { ascending: false }).limit(30),
      // Real current/longest daily-activity streak, derived live from this
      // profile's own xp_ledger rows — see get_activity_streak() for the
      // full "qualifying day" definition and reasoning.
      supabase.rpc("get_activity_streak", { p_profile_id: profile.id }).single(),
      // Just enough of this week's xp_ledger to know which real days were
      // active, for the Mon-Sun strip below. Same own-rows RLS as the XP
      // history query above — never another user's activity.
      supabase.from("xp_ledger").select("created_at").gte("created_at", weekStartUtc.toISOString()),
    ]);

  const totalXp = xpTotal ?? 0;
  const earnedBadgeDates = new Map((earnedBadges ?? []).map((b) => [b.badge_id, b.awarded_at] as const));

  const currentStreak = streak?.current_streak ?? 0;
  const longestStreak = streak?.longest_streak ?? 0;
  const tier = getStreakTier(currentStreak);
  const activeDatesThisWeek = new Set(
    (weekXp ?? []).map((row) => new Date(row.created_at).toISOString().slice(0, 10)),
  );
  const weekStrip = buildWeekStrip(todayUtc, activeDatesThisWeek);
  const xpHistoryGroups = xpHistory ? groupXpHistoryByDay(xpHistory, todayUtc) : [];
  const streakMessage =
    currentStreak === 0
      ? "Post in the community, or wait for your next correct prediction to be scored, to start your streak today."
      : currentStreak === 1
        ? "Nice start — come back tomorrow to keep it going."
        : `${currentStreak} days strong. Keep the streak alive.`;

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

      <FadeIn delay={0.05} className="kivo-glass-brand flex items-center gap-4 rounded-3xl p-6">
        <div className="kivo-gradient-victory flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl">
          <Zap className="h-6 w-6 text-on-accent" strokeWidth={1.75} />
        </div>
        <div>
          {totalXp > 0 ? (
            <span className="text-3xl font-bold tracking-tight text-foreground">
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
            <span className="text-3xl font-bold tracking-tight text-foreground">0 XP</span>
          )}
          <p className="mt-1 text-xs text-foreground-subtle">Earned from onboarding, community posts and correct predictions</p>
        </div>
      </FadeIn>

      <FadeIn delay={0.08} className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <Flame className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Activity streak
        </h2>

        {/* Big pill stat: flame + current streak. Driven entirely by
            get_activity_streak() — a profile with zero qualifying days
            genuinely shows 0, never a placeholder number. */}
        <div className="kivo-glass flex items-center gap-3 rounded-3xl p-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2">
            <Flame className="h-5 w-5 text-accent" strokeWidth={1.75} />
          </div>
          <div>
            <span className="text-2xl font-bold tracking-tight text-foreground">{currentStreak}</span>
            <span className="ml-1.5 text-sm font-medium text-foreground-muted">
              {currentStreak === 1 ? "Day streak" : "Days streak"}
            </span>
          </div>
        </div>

        {/* Mon-Sun week strip, real dates in UTC. Future days are always
            plain (no fake checkmark); past/today days light up only if a
            real xp_ledger row exists for that date. */}
        <div className="kivo-glass flex items-center justify-between rounded-2xl p-3">
          {weekStrip.map((day) => (
            <div key={day.isoDate} className="flex flex-1 flex-col items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground-subtle">
                {day.label}
              </span>
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                  day.isActive
                    ? "kivo-gradient-victory text-on-accent"
                    : day.isFuture
                      ? "bg-surface-2 text-foreground-subtle/50"
                      : "bg-surface-2 text-foreground-subtle"
                } ${day.isToday ? "ring-1 ring-inset ring-accent/50" : ""}`}
              >
                {day.dayNumber}
              </div>
            </div>
          ))}
        </div>

        {/* Tier + longest streak, side by side. */}
        <div className="grid grid-cols-2 gap-3">
          <div className="kivo-glass rounded-2xl p-4">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
              <Trophy className="h-3.5 w-3.5 text-achievement" strokeWidth={1.75} />
              Tier
            </span>
            <p className="mt-1.5 text-lg font-bold text-foreground">{tier.tierName}</p>
          </div>
          <div className="kivo-glass rounded-2xl p-4">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
              <Flame className="h-3.5 w-3.5 text-accent" strokeWidth={1.75} />
              Longest streak
            </span>
            <p className="mt-1.5 text-lg font-bold text-foreground">
              {longestStreak} {longestStreak === 1 ? "day" : "days"}
            </p>
          </div>
        </div>

        {/* Progress toward the next tier — see STREAK_TIER_LENGTH_DAYS in
            src/lib/streak.ts for the single source of truth on the 7-day
            threshold this bar and copy both use. */}
        <div className="kivo-glass rounded-2xl p-4">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-track">
            <div
              className="kivo-gradient-prime h-full rounded-full transition-[width]"
              style={{ width: `${Math.round(tier.progress * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-foreground-subtle">
            {tier.daysToNextTier} more {tier.daysToNextTier === 1 ? "day" : "days"} to unlock next tier
          </p>
          <p className="mt-2 text-xs text-foreground-muted">{streakMessage}</p>
        </div>
      </FadeIn>

      <FadeIn delay={0.1} className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <Award className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Badges
        </h2>

        {!allBadges || allBadges.length === 0 ? (
          <div className="kivo-glass rounded-2xl p-6 text-center text-sm text-foreground-muted">
            No badges available yet.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {allBadges.map((badge, index) => {
              const earnedAt = earnedBadgeDates.get(badge.id);
              const earned = earnedAt !== undefined;
              return (
                <FadeIn key={badge.id} delay={0.12 + staggerDelay(index, 0.03, allBadges.length)}>
                  <div
                    className={`kivo-glass flex flex-col items-center gap-2 rounded-2xl p-4 text-center ${
                      earned
                        ? "transition ring-1 ring-inset ring-accent/25 hover:-translate-y-0.5"
                        : "opacity-40 grayscale"
                    }`}
                  >
                    {badge.icon_url && (
                      <Image
                        src={badge.icon_url}
                        alt=""
                        width={40}
                        height={40}
                        className={`h-10 w-10 ${earned ? "drop-shadow-[0_0_10px_var(--accent-hairline)]" : ""}`}
                      />
                    )}
                    <span className="text-xs font-semibold text-foreground">{badge.name}</span>
                    <span className="text-[11px] text-foreground-subtle">{badge.description}</span>
                    {earned ? (
                      <span className="text-[10px] font-medium text-accent">Earned {timeAgo(earnedAt)}</span>
                    ) : (
                      <span className="rounded-full border border-hairline px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
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
          <History className="h-4 w-4 text-accent" strokeWidth={1.75} />
          XP history
        </h2>

        {!xpHistory || xpHistory.length === 0 ? (
          <div className="kivo-glass rounded-2xl p-6 text-center text-sm text-foreground-muted">
            No XP earned yet. Complete onboarding or post in the community to get started.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {xpHistoryGroups.map((group) => (
              <div key={group.label} className="flex flex-col gap-1.5">
                <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
                  {group.label}
                </p>
                <div className="kivo-glass flex flex-col divide-y divide-hairline-soft rounded-3xl">
                  {collapseConsecutiveXpEntries(group.entries).map((line) => (
                    <div key={line.key} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div>
                        <p className="text-xs font-medium text-foreground">{line.reason}</p>
                        <p className="text-[11px] text-foreground-subtle">{timeAgo(line.created_at)}</p>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-live">
                        {line.amount > 0 ? "+" : ""}
                        {line.amount} XP
                        {line.count > 1 && <span className="text-foreground-subtle"> &times; {line.count}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </FadeIn>
    </div>
  );
}
