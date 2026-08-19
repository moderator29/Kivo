import Link from "next/link";
import {
  Bell,
  Flame,
  MessagesSquare,
  Sparkles,
  Target,
  Trophy,
  UserRound,
  ArrowLeftRight,
} from "lucide-react";
import { TeamCrest } from "@/components/ui/team-crest";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import { HomeSectionCard } from "@/components/home/section-card";
import { TRANSFER_TYPE_LABEL } from "@/lib/football/transfer-labels";
import { describeNotification, notificationHref, notificationIcon } from "@/lib/notification-registry";
import type { NotificationRow } from "@/lib/notifications";
import type { BriefingLine } from "@/lib/home-briefing";
import type { QuickAction } from "@/lib/home-sections";
import type { FantasySummary, FollowedPlayer, PredictionSummary, PulseTransfer, TrendingRoom } from "@/lib/home/data";
import { DISPLAY_LOCALE, formatDurationUntil, timeAgo } from "@/lib/format";

/**
 * The /home sections that did not exist before this pass, plus the briefing
 * and the quick-actions row.
 *
 * All Server Components. Every one of them assumes its caller has already
 * decided the section belongs on the page (that is `selectHomeSections`' job)
 * and that its data is non-empty — so none of them render an empty state.
 * That is deliberate: an empty state here would be a section the ordering
 * module said not to show, appearing anyway.
 */

/* ------------------------------------------------------------------ */

/**
 * The briefing.
 *
 * The lines are composed deterministically from real rows (`home-briefing.ts`
 * explains why they are not model-written). The Copilot line at the bottom is
 * the only AI-branded thing on the card and it renders only when the Copilot
 * is genuinely configured — the same boolean the navigation uses to decide
 * whether /ai is a real destination or a Coming Soon. Home and the nav can
 * therefore never disagree about whether KIVO has an AI.
 */
export function BriefingCard({ lines, aiConfigured }: { lines: BriefingLine[]; aiConfigured: boolean }) {
  return (
    <section className="kivo-glass-brand rounded-2xl p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Your day on KIVO</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {lines.map((line) => (
          <li key={line.id}>
            <Link
              href={line.href}
              className="kivo-focus group flex items-start gap-2.5 rounded-xl px-2 py-1.5 -mx-2 transition-colors hover:bg-surface-2"
            >
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
              <span className="text-sm leading-relaxed text-foreground">{line.text}</span>
            </Link>
          </li>
        ))}
      </ul>
      {aiConfigured && (
        <Link
          href="/ai"
          className="kivo-focus mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-accent-strong"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
          Ask the Copilot about any of this
        </Link>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

/** Contextual shortcuts. Which four appear, and in what order, is decided by
 * `selectQuickActions` from the same facts everything else on the page uses —
 * so this is never the same row twice for two different readers. */
export function QuickActionsRow({ actions }: { actions: QuickAction[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {actions.map((action) => (
        <Link
          key={action.id}
          href={action.href}
          className="kivo-glass-sharp kivo-focus flex flex-col gap-0.5 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-2"
        >
          <span className="text-xs font-semibold text-foreground">{action.label}</span>
          <span className="text-[10px] leading-snug text-foreground-subtle">{action.hint}</span>
        </Link>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** What happened while they were away. Only ever rendered with a real unread
 * count behind it — there is no "you're all caught up" card, because a card
 * that exists to say nothing happened is noise. */
export function NotificationsCard({
  notifications,
  reason,
}: {
  notifications: NotificationRow[];
  reason: string;
}) {
  return (
    <HomeSectionCard
      icon={<Bell className="h-4 w-4" strokeWidth={1.75} />}
      title="While you were away"
      reason={reason}
      action={{ href: "/notifications", label: "All" }}
    >
      <ul className="flex flex-col gap-1.5">
        {notifications.map((notification) => {
          const Icon = notificationIcon(notification);
          return (
            <li key={notification.id}>
              <Link
                href={notificationHref(notification)}
                className="kivo-focus flex items-start gap-2.5 rounded-xl px-2 py-2 -mx-2 transition-colors hover:bg-surface-2"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 text-sm leading-snug text-foreground">
                  {describeNotification(notification)}
                </span>
                <span className="shrink-0 text-[11px] text-foreground-subtle">{timeAgo(notification.created_at)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </HomeSectionCard>
  );
}

/* ------------------------------------------------------------------ */

/** The busiest Match Rooms. The number is a count of distinct real people who
 * posted — see `loadTrendingRooms` for why a one-person Room is excluded
 * rather than rounded up. */
export function TrendingRoomsCard({ rooms, reason }: { rooms: TrendingRoom[]; reason: string }) {
  return (
    <HomeSectionCard
      icon={<MessagesSquare className="h-4 w-4" strokeWidth={1.75} />}
      title="Busiest Rooms"
      reason={reason}
      action={{ href: "/social", label: "Feed" }}
    >
      <ul className="flex flex-col gap-2">
        {rooms.map((room) => (
          <li key={room.fixtureId}>
            <Link
              href={`/matches/${room.fixtureId}`}
              className="kivo-glass-sharp kivo-focus flex items-center gap-3 rounded-xl p-3 transition-colors hover:bg-surface-2"
            >
              <span className="flex shrink-0 items-center -space-x-1.5">
                <TeamCrest crestUrl={room.homeCrestUrl} name={room.homeName} size={22} />
                <TeamCrest crestUrl={room.awayCrestUrl} name={room.awayName} size={22} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {room.homeName} v {room.awayName}
              </span>
              {room.isLive && (
                <span className="flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-live">
                  <span className="h-1.5 w-1.5 rounded-full bg-live" aria-hidden="true" />
                  Live
                </span>
              )}
              <span className="shrink-0 text-xs font-medium tabular-nums text-foreground-muted">
                {room.participantCount === 1 ? "1 person" : `${room.participantCount} people`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </HomeSectionCard>
  );
}

/* ------------------------------------------------------------------ */

/** Completed, recorded moves involving who this viewer follows. Every row
 * here is a move that actually happened — KIVO has no rumour tier, and
 * RECOMMENDATIONS.md item 178 explains why it never will on this data. */
export function TransferPulseCard({ transfers, reason }: { transfers: PulseTransfer[]; reason: string }) {
  return (
    <HomeSectionCard
      icon={<ArrowLeftRight className="h-4 w-4" strokeWidth={1.75} />}
      title="Transfer pulse"
      reason={reason}
      action={{ href: "/transfers", label: "All" }}
    >
      <ul className="flex flex-col gap-2">
        {transfers.map((transfer) => (
          <li key={transfer.id}>
            <Link
              href={`/players/${transfer.playerId}`}
              className="kivo-glass-sharp kivo-focus flex items-center gap-3 rounded-xl p-3 transition-colors hover:bg-surface-2"
            >
              <TeamCrest crestUrl={transfer.toTeamCrestUrl} name={transfer.toTeamName ?? ""} size={24} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-foreground">{transfer.playerName}</span>
                <span className="truncate text-[11px] text-foreground-subtle">
                  {transfer.fromTeamName && transfer.toTeamName
                    ? `${transfer.fromTeamName} → ${transfer.toTeamName}`
                    : (transfer.toTeamName ?? transfer.fromTeamName ?? TRANSFER_TYPE_LABEL[transfer.typeKey])}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end">
                <span className="text-[11px] font-medium text-foreground-muted">
                  {TRANSFER_TYPE_LABEL[transfer.typeKey]}
                </span>
                <span className="text-[10px] text-foreground-subtle">{transfer.dateLabel}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </HomeSectionCard>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Fantasy points and rank.
 *
 * Three numbers, and each one is omitted rather than zeroed when it isn't
 * real: points only exist once a gameweek has been scored, a rank only exists
 * once the league leaderboard has scores in it, and the deadline countdown
 * only renders while the deadline is genuinely in the future.
 */
export function FantasyCard({
  summary,
  deadlineAt,
  rosterConfirmed,
  gameweekNumber,
  now,
  reason,
}: {
  summary: FantasySummary;
  deadlineAt: string | null;
  rosterConfirmed: boolean;
  gameweekNumber: number | null;
  now: number;
  reason: string;
}) {
  const countdown = deadlineAt ? formatDurationUntil(deadlineAt, now) : null;

  return (
    <HomeSectionCard
      icon={<Trophy className="h-4 w-4" strokeWidth={1.75} />}
      title="Fantasy"
      reason={reason}
      action={{ href: "/fantasy", label: "Open" }}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-sm font-medium text-foreground">{summary.teamName}</span>
          {summary.leagueName && (
            <span className="shrink-0 truncate text-[11px] text-foreground-subtle">{summary.leagueName}</span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {summary.latestPoints !== null && (
            <span className="kivo-glass-sharp flex flex-col rounded-xl px-3 py-2">
              <span className="text-lg font-semibold tabular-nums text-foreground">{summary.latestPoints}</span>
              <span className="text-[10px] uppercase tracking-wide text-foreground-subtle">
                {summary.latestGameweekNumber !== null ? `GW${summary.latestGameweekNumber} points` : "Last scored"}
              </span>
            </span>
          )}
          {summary.rank !== null && (
            <span className="kivo-glass-sharp flex flex-col rounded-xl px-3 py-2">
              <span className="text-lg font-semibold tabular-nums text-foreground">
                {summary.rank}
                {summary.entriesRanked !== null && (
                  <span className="text-xs font-normal text-foreground-subtle"> / {summary.entriesRanked}</span>
                )}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-foreground-subtle">League rank</span>
            </span>
          )}
          {countdown && gameweekNumber !== null && (
            <span className="kivo-glass-sharp flex flex-col rounded-xl px-3 py-2">
              <span className={`text-lg font-semibold ${rosterConfirmed ? "text-foreground" : "text-warning"}`}>
                {countdown}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-foreground-subtle">
                GW{gameweekNumber} {rosterConfirmed ? "locks" : "— squad not in"}
              </span>
            </span>
          )}
        </div>
      </div>
    </HomeSectionCard>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Predictions: what is still open, and the streak.
 *
 * A streak of zero produces no streak tile — the section itself is only on the
 * page when there is either an open call or a live run, so this never renders
 * a row of noughts.
 */
export function PredictionsCard({
  summary,
  now,
  reason,
}: {
  summary: PredictionSummary;
  now: number;
  reason: string;
}) {
  const locksIn = summary.nextLockAt ? formatDurationUntil(summary.nextLockAt, now) : null;

  return (
    <HomeSectionCard
      icon={<Target className="h-4 w-4" strokeWidth={1.75} />}
      title="Your calls"
      reason={reason}
      action={{ href: "/predictions/mine", label: "Open" }}
    >
      <div className="flex flex-wrap gap-2">
        {summary.openCount > 0 && (
          <span className="kivo-glass-sharp flex flex-col rounded-xl px-3 py-2">
            <span className="text-lg font-semibold tabular-nums text-foreground">{summary.openCount}</span>
            <span className="text-[10px] uppercase tracking-wide text-foreground-subtle">
              {locksIn ? `open · next in ${locksIn}` : "still open"}
            </span>
          </span>
        )}
        {summary.currentStreak > 0 && (
          <span className="kivo-glass-sharp flex flex-col rounded-xl px-3 py-2">
            <span className="flex items-center gap-1 text-lg font-semibold tabular-nums text-foreground">
              <Flame className="h-4 w-4 text-accent" strokeWidth={1.75} />
              {summary.currentStreak}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-foreground-subtle">In a row</span>
          </span>
        )}
        {summary.scoredCount > 0 && (
          <span className="kivo-glass-sharp flex flex-col rounded-xl px-3 py-2">
            <span className="text-lg font-semibold tabular-nums text-foreground">
              {summary.correctCount}
              <span className="text-xs font-normal text-foreground-subtle"> / {summary.scoredCount}</span>
            </span>
            <span className="text-[10px] uppercase tracking-wide text-foreground-subtle">Called right</span>
          </span>
        )}
      </div>
    </HomeSectionCard>
  );
}

/* ------------------------------------------------------------------ */

/** The players this viewer follows — the half of the follow graph /home never
 * read before this pass. A player whose club has no synced upcoming fixture
 * shows their club and nothing else, rather than a placeholder date. */
export function FollowedPlayersCard({ players, reason }: { players: FollowedPlayer[]; reason: string }) {
  return (
    <HomeSectionCard
      icon={<UserRound className="h-4 w-4" strokeWidth={1.75} />}
      title="Your players"
      reason={reason}
      action={{ href: "/profile/following", label: "Manage" }}
    >
      <ul className="flex flex-col gap-2">
        {players.map((player) => (
          <li key={player.id}>
            <Link
              href={`/players/${player.id}`}
              className="kivo-glass-sharp kivo-focus flex items-center gap-3 rounded-xl p-3 transition-colors hover:bg-surface-2"
            >
              <PlayerAvatar photoUrl={player.photoUrl} name={player.name} size={32} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-foreground">{player.name}</span>
                <span className="truncate text-[11px] text-foreground-subtle">
                  {[player.position, player.teamName].filter(Boolean).join(" · ")}
                </span>
              </span>
              {player.nextFixture && (
                <span className="flex shrink-0 flex-col items-end">
                  <span className="text-[11px] font-medium text-foreground-muted">
                    v {player.nextFixture.opponentName}
                  </span>
                  <span className="text-[10px] text-foreground-subtle">
                    {new Date(player.nextFixture.kickoffAt).toLocaleDateString(DISPLAY_LOCALE, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </HomeSectionCard>
  );
}
