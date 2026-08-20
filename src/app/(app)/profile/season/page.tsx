import type { Metadata } from "next";
import Link from "next/link";
import { Flame, Target, Trophy, Users, MessageSquare, Award } from "lucide-react";
import { getOrCreateProfile } from "@/lib/profile";
import { getSeasonSummary, MIN_SETTLED_FOR_ACCURACY } from "@/lib/season-summary";
import { resolveTimeZone } from "@/lib/timezone";
import { FadeIn } from "@/components/ui/fade-in";
import { formatDate, formatNumber } from "@/lib/format";
import { staggerDelay } from "@/lib/stagger";
import { SeasonFantasyArc } from "@/components/profile/season-fantasy-arc";
import { ProfileUnavailable } from "@/components/auth/profile-unavailable";

export const metadata: Metadata = { title: "Your season" };

/**
 * KN-98. A season told entirely out of the reader's own rows.
 *
 * The reason this can exist at all, on a platform with almost no users, is that
 * nothing here is an aggregate over anybody else. There is no rank, no
 * percentile, no "better than X% of managers" — so there is no minimum sample
 * to reach and nothing that becomes a lie when the platform is small. "You
 * made three calls and got two right" is exactly as true today as it will be
 * with a million accounts.
 *
 * Everything reads through the viewer's own session, so RLS is the scope:
 * `predictions_select_own`, `xp_ledger_select_own`, `user_badges_select_own`
 * and the rest were already the boundary and this adds no way around them.
 *
 * A figure KIVO could not read renders as nothing at all rather than as zero.
 * Zero is a claim — "you have written no posts" — and a failed count has not
 * earned the right to make it.
 *
 * FRONTEND SWEEP 2026-08-19. Every one of the six regions below used to be its
 * own `kivo-glass rounded-3xl p-5` panel, stacked. Six identical glass boxes,
 * each holding a caps heading and a row of numbers, at the FEATURE radius —
 * and `CONTAINER_ROLES.feature` says outright that "more than one on a screen
 * means none of them is a feature". `Section`'s own doc names the failure this
 * caused: "the default here is no surface at all … wrapping [a paragraph] in
 * glass is how the dashboard look happens." The headings and the `.kivo-page`
 * rhythm separate these regions perfectly well without six boxes to do it.
 */
export default async function SeasonPage() {
  const profile = await getOrCreateProfile();

  // The (app) layout already guarantees a signed-in viewer with a real profile
  // row, so a null here is not a guest — it is a transient read failure between
  // that check and this one. See src/lib/guest-preview.ts.
  if (!profile) return <ProfileUnavailable />;

  const summary = await getSeasonSummary(profile.id, profile.created_at);
  // KN-89: the joined date is a real instant, so it is shown in the zone the
  // user actually told us about — and in UTC, plainly, when they have not.
  const { timeZone, isStated } = resolveTimeZone(profile.timezone);

  return (
    <div className="kivo-page">
      <FadeIn className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Your season</h1>
        <p className="text-xs text-foreground-subtle">
          Everything here is counted from your own activity. Nothing is compared against anyone else, so nothing on
          this page depends on how many other people are using KIVO.
        </p>
      </FadeIn>

      {summary.isEmpty ? (
        <FadeIn delay={0.05} className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-8 text-center">
          <Trophy className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
          <p className="text-sm text-foreground-muted">
            Your season hasn&apos;t started yet. Make a prediction, post in a Match Room, or pick a fantasy squad —
            this page fills itself in from whatever you actually do.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Link
              href="/predictions"
              className="kivo-glass-sharp rounded-xl px-4 py-2 text-xs font-semibold text-foreground transition-transform active:scale-95"
            >
              Make a prediction
            </Link>
            <Link
              href="/social"
              className="kivo-glass-sharp rounded-xl px-4 py-2 text-xs font-semibold text-foreground transition-transform active:scale-95"
            >
              Join the conversation
            </Link>
          </div>
        </FadeIn>
      ) : (
        <>
          {summary.predictions && summary.predictions.total > 0 && (
            <FadeIn delay={0.05} className="flex flex-col gap-3">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                <Target className="h-3.5 w-3.5" strokeWidth={2} />
                Predictions
              </h2>
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                <Stat value={formatNumber(summary.predictions.total)} label="made" />
                <Stat
                  value={`${formatNumber(summary.predictions.correct)} of ${formatNumber(summary.predictions.settled)}`}
                  label="correct so far"
                />
                {summary.predictions.accuracyPct !== null && (
                  <Stat value={`${summary.predictions.accuracyPct}%`} label="accuracy" />
                )}
              </div>
              {summary.predictions.accuracyPct === null && summary.predictions.settled > 0 && (
                <p className="text-[11px] text-foreground-subtle">
                  A percentage appears once {MIN_SETTLED_FOR_ACCURACY} of your calls have been scored. Your real record
                  is above either way — one right answer out of one is true, but it isn&apos;t an accuracy.
                </p>
              )}
              {summary.predictions.settled === 0 && (
                <p className="text-[11px] text-foreground-subtle">
                  None of your calls have been scored yet. They settle after the matches finish.
                </p>
              )}
            </FadeIn>
          )}

          {(summary.currentStreak !== null || summary.totalXp !== null) && (
            <FadeIn delay={0.08} className="flex flex-col gap-3">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                <Flame className="h-3.5 w-3.5" strokeWidth={2} />
                Consistency
              </h2>
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                {summary.currentStreak !== null && (
                  <Stat value={`${formatNumber(summary.currentStreak)}d`} label="current streak" />
                )}
                {summary.longestStreak !== null && (
                  <Stat value={`${formatNumber(summary.longestStreak)}d`} label="longest streak" />
                )}
                {summary.totalXp !== null && <Stat value={formatNumber(summary.totalXp)} label="XP earned" />}
              </div>
            </FadeIn>
          )}

          {summary.fantasyArc && summary.fantasyArc.length > 0 && (
            <FadeIn delay={0.11} className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                  <Trophy className="h-3.5 w-3.5" strokeWidth={2} />
                  Fantasy
                </h2>
                {summary.fantasyTotal !== null && (
                  <span className="text-xs text-foreground-muted">
                    {formatNumber(summary.fantasyTotal)} points total
                  </span>
                )}
              </div>
              <SeasonFantasyArc gameweeks={summary.fantasyArc} />
            </FadeIn>
          )}

          {summary.badges && summary.badges.length > 0 && (
            <FadeIn delay={0.14} className="flex flex-col gap-3">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                <Award className="h-3.5 w-3.5" strokeWidth={2} />
                Badges
              </h2>
              <ul className="flex flex-wrap gap-2">
                {summary.badges.map((badge, index) => (
                  <li
                    key={`${badge.name}-${index}`}
                    className="rounded-full border border-hairline px-3 py-1 text-[11px] text-foreground-muted"
                    style={{ animationDelay: `${staggerDelay(index, 0.03)}s` }}
                  >
                    <span className="font-semibold text-foreground">{badge.name}</span>{" "}
                    <span className="text-foreground-subtle">{formatDate(badge.awardedAt, { month: "short" })}</span>
                  </li>
                ))}
              </ul>
            </FadeIn>
          )}

          {((summary.posts ?? 0) > 0 || (summary.comments ?? 0) > 0) && (
            <FadeIn delay={0.17} className="flex flex-col gap-3">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
                In the conversation
              </h2>
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                {summary.posts !== null && <Stat value={formatNumber(summary.posts)} label="posts" />}
                {summary.comments !== null && <Stat value={formatNumber(summary.comments)} label="comments" />}
              </div>
            </FadeIn>
          )}

          {summary.follows &&
            summary.follows.teams + summary.follows.players + summary.follows.competitions + summary.follows.people >
              0 && (
              <FadeIn delay={0.2} className="flex flex-col gap-3">
                <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                  <Users className="h-3.5 w-3.5" strokeWidth={2} />
                  Following
                </h2>
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                  {summary.follows.teams > 0 && <Stat value={formatNumber(summary.follows.teams)} label="clubs" />}
                  {summary.follows.players > 0 && (
                    <Stat value={formatNumber(summary.follows.players)} label="players" />
                  )}
                  {summary.follows.competitions > 0 && (
                    <Stat value={formatNumber(summary.follows.competitions)} label="competitions" />
                  )}
                  {summary.follows.people > 0 && <Stat value={formatNumber(summary.follows.people)} label="people" />}
                </div>
              </FadeIn>
            )}
        </>
      )}

      {summary.memberSince && (
        <FadeIn delay={0.23} className="text-center text-[11px] text-foreground-subtle">
          On KIVO since {formatDate(summary.memberSince, { month: "long" })}
          {isStated ? "" : " · times shown in UTC until you set your time zone in Settings"}
          <span className="sr-only"> ({timeZone})</span>
        </FadeIn>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xl font-semibold tracking-tight text-foreground">{value}</span>
      <span className="text-[11px] text-foreground-subtle">{label}</span>
    </div>
  );
}
