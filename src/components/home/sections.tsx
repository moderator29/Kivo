import Link from "next/link";
import { MessagesSquare, Sparkles } from "lucide-react";
import { TeamCrest } from "@/components/ui/team-crest";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import { KivoAvatar } from "@/components/ui/kivo-avatar";
import { CompetitionLogo } from "@/components/ui/competition-logo";
import { Section } from "@/components/ui/section";
import { ListRow, ListSurface } from "@/components/ui/list-surface";
import { StatBlock, StatGrid } from "@/components/ui/stat-block";
import { SectionLink } from "@/components/home/section-action";
import { TRANSFER_TYPE_LABEL } from "@/lib/football/transfer-labels";
import { describeNotification, notificationHref, notificationIcon } from "@/lib/notification-registry";
import type { NotificationRow } from "@/lib/notifications";
import type { BriefingLine } from "@/lib/home-briefing";
import type { QuickAction } from "@/lib/home-sections";
import type {
  FantasySummary,
  FollowedCompetition,
  FollowedPlayer,
  PredictionSummary,
  PulseTransfer,
  TrendingRoom,
} from "@/lib/home/data";
import type { PostListItem } from "@/app/(app)/social/posts";
import { formatDurationUntil, timeAgo } from "@/lib/format";

/**
 * Everything on /home that is not a match list or the lead slot.
 *
 * All Server Components. Every one of them assumes its caller has already
 * decided the section belongs on the page (that is `selectHomeSections`' job)
 * and that its data is non-empty — so none of them render an empty state.
 * That is deliberate: an empty state here would be a section the ordering
 * module said not to show, appearing anyway.
 *
 * ## The rebuild
 *
 * These were eight variations on one shape: a glass card with an accent icon,
 * an uppercase micro-heading, a line of explanatory copy and an arrow — and
 * inside it, every list item boxed *again* in `kivo-glass-sharp`. Stacked, they
 * gave the page no hierarchy at all, and the nesting broke KIVO's own
 * `DENSITY_RULES`. Nothing here hand-rolls a container any more; every section
 * is one of exactly three shapes from `docs/UI_PRIMITIVES.md`:
 *
 *   `<Section>` + `<ListSurface>`   a list of things (players, transfers, posts)
 *   `<Section>` + `<MatchList>`     matches — the one fixture row in the app
 *   `<Section>` + `<StatGrid>`      two to four numbers, on one surface
 *
 * A section that cannot express itself in one of the three has not decided
 * what it is.
 *
 * ## Why almost nothing carries a description
 *
 * The previous build printed a sentence of justification under every single
 * heading — "The rest of today's football on KIVO", "The KIVO feed". A football
 * app does not explain its own headings, and eight explanations stacked is how
 * a page starts sounding generated rather than designed. The ladder still
 * computes a reason for every section, and the page renders it only where it
 * states a fact the heading does not already carry: "Arsenal and 2 others",
 * "Next locks in 2h".
 */

/* ------------------------------------------------------------------ */
/* The briefing                                                         */
/* ------------------------------------------------------------------ */

/**
 * The briefing — deterministic lines composed from real rows
 * (`home-briefing.ts` explains why they are not model-written).
 *
 * The Copilot line at the bottom is the only AI-branded thing on the page and
 * it renders only when the Copilot is genuinely configured — the same boolean
 * the navigation uses to decide whether /ai is a real destination. Home and the
 * nav can therefore never disagree about whether KIVO has an AI, and there is
 * no longer a banner advertising one that does not exist yet.
 *
 * No heading: it summarises the sections below it rather than being one of
 * them, and a title would put it in the same rank as the things it is about.
 */
export function BriefingCard({ lines, aiConfigured }: { lines: BriefingLine[]; aiConfigured: boolean }) {
  return (
    <section aria-label="Your day">
      <ListSurface>
        {lines.map((line) => (
          <ListRow
            key={line.id}
            href={line.href}
            leading={<span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />}
            title={<span className="whitespace-normal">{line.text}</span>}
          />
        ))}
        {aiConfigured && (
          <ListRow
            href="/ai"
            leading={<Sparkles className="h-4 w-4 text-accent" strokeWidth={1.75} />}
            title={<span className="text-accent">Ask the Copilot about any of this</span>}
          />
        )}
      </ListSurface>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Quick actions                                                        */
/* ------------------------------------------------------------------ */

/**
 * Contextual shortcuts, as a scrollable rail of pills.
 *
 * This was a four-up grid of bordered tiles, each with a label and a sentence
 * of explanation under it — a second navigation bar wearing cards, and four
 * more boxes on a page that already had too many. A pill rail survives 390px
 * without wrapping into two rows of tiny text, and each pill clears 44px.
 *
 * Not `<SectionTabs>`: these are links to other routes, and the primitives
 * contract is explicit that a row of links between routes is a nav rather than
 * a tablist — using a tablist for it would announce "tab 3 of 4" for something
 * that unloads the page.
 *
 * Which pills appear, and in what order, is decided by `selectQuickActions`
 * from the same facts everything else on the page uses.
 */
export function QuickActionsRail({ actions }: { actions: QuickAction[] }) {
  return (
    <nav
      aria-label="Shortcuts"
      // -mx-4/px-4 lets the rail bleed to the screen edge on a phone so the
      // last pill is visibly cut off rather than sitting flush, which is what
      // tells a thumb there is more to scroll.
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:-mx-8 lg:px-8"
    >
      {actions.map((action) => (
        <Link
          key={action.id}
          href={action.href}
          className="kivo-glass-sharp kivo-focus flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
        >
          {action.label}
          {action.hint && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold tabular-nums text-accent">
              {action.hint}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Notifications                                                        */
/* ------------------------------------------------------------------ */

/** What happened while they were away. Only ever rendered with a real unread
 * count behind it — there is no "you're all caught up" card, because a card
 * that exists to say nothing happened is noise. */
export function NotificationsSection({
  notifications,
  description,
}: {
  notifications: NotificationRow[];
  description: string | null;
}) {
  return (
    <Section
      title="While you were away"
      description={description}
      action={<SectionLink href="/notifications" label="All" />}
    >
      <ListSurface>
        {notifications.map((notification) => {
          const Icon = notificationIcon(notification);
          return (
            <ListRow
              key={notification.id}
              href={notificationHref(notification)}
              leading={<Icon className="h-4 w-4 text-accent" strokeWidth={1.75} />}
              title={<span className="whitespace-normal">{describeNotification(notification)}</span>}
              trailing={<span className="text-xs text-foreground-subtle">{timeAgo(notification.created_at)}</span>}
            />
          );
        })}
      </ListSurface>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Match Rooms                                                          */
/* ------------------------------------------------------------------ */

/** The busiest Match Rooms. The number is a count of distinct real people who
 * posted — see `loadTrendingRooms` for why a one-person Room is excluded
 * rather than rounded up. */
export function TrendingRoomsSection({ rooms }: { rooms: TrendingRoom[] }) {
  return (
    <Section title="Busiest Match Rooms" action={<SectionLink href="/social" label="Feed" />}>
      <ListSurface>
        {rooms.map((room) => (
          <ListRow
            key={room.fixtureId}
            href={`/matches/${room.fixtureId}`}
            leading={
              <span className="flex items-center -space-x-1.5">
                <TeamCrest crestUrl={room.homeCrestUrl} name={room.homeName} size={22} />
                <TeamCrest crestUrl={room.awayCrestUrl} name={room.awayName} size={22} />
              </span>
            }
            title={`${room.homeName} v ${room.awayName}`}
            trailing={
              <span className="flex items-center gap-2.5">
                {room.isLive && (
                  <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-live">
                    <span className="h-1.5 w-1.5 rounded-full bg-live" aria-hidden="true" />
                    Live
                  </span>
                )}
                <span className="flex items-center gap-1 text-sm tabular-nums">
                  <MessagesSquare className="h-3.5 w-3.5" strokeWidth={2} />
                  {room.participantCount}
                </span>
              </span>
            }
          />
        ))}
      </ListSurface>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* The personalised feed                                                */
/* ------------------------------------------------------------------ */

/** How much of a post reaches Home. Long enough to carry a real take, short
 * enough that three of them do not become the page. The full post is one tap
 * away, and it is never truncated without the ellipsis saying so. */
const FEED_EXCERPT_CHARS = 140;

function excerpt(body: string): string {
  const text = body.trim().replace(/\s+/g, " ");
  if (text.length <= FEED_EXCERPT_CHARS) return text;
  return `${text.slice(0, FEED_EXCERPT_CHARS).trimEnd()}…`;
}

/**
 * Posts by the people this viewer follows.
 *
 * The slot this occupies used to hold a "Community" card containing a fixed
 * paragraph — "The KIVO feed is live. Share your take…" — with no data behind
 * it, present on every render whether or not a single person had posted. That
 * is an advertisement, not a section. This is the real thing: real posts by
 * accounts the reader chose, and no section at all when there are none.
 *
 * A hand-built row rather than `<ListRow>`: a post is a paragraph with an
 * author and a reaction count above and below it, not a title with a subtitle,
 * and forcing it into the row's slots would truncate the one thing it is for.
 */
export function FeedSection({ posts }: { posts: PostListItem[] }) {
  return (
    <Section title="From people you follow" action={<SectionLink href="/social?filter=following" label="Feed" />}>
      <ListSurface>
        {posts.map((post) => (
          <li key={post.id}>
            <Link
              href={`/social?post=${post.id}`}
              className="kivo-focus flex gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
            >
              <KivoAvatar src={post.authorAvatarSrc} name={post.authorName} size={32} className="mt-0.5 shrink-0" />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">{post.authorName}</span>
                  <span className="shrink-0 text-xs text-foreground-subtle">{timeAgo(post.createdAt)}</span>
                </span>
                <span className="text-sm leading-snug text-foreground-muted">{excerpt(post.body)}</span>
                {(post.reactionCount > 0 || post.commentCount > 0) && (
                  <span className="flex items-center gap-3 text-xs tabular-nums text-foreground-subtle">
                    {post.reactionCount > 0 && <span>{post.reactionCount} reactions</span>}
                    {post.commentCount > 0 && <span>{post.commentCount} replies</span>}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ListSurface>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Transfers                                                            */
/* ------------------------------------------------------------------ */

/** Completed, recorded moves involving who this viewer follows. Every row here
 * is a move that actually happened — KIVO has no rumour tier, and
 * RECOMMENDATIONS.md item 178 explains why it never will on this data. */
export function TransferSection({ transfers }: { transfers: PulseTransfer[] }) {
  return (
    <Section title="Transfers" action={<SectionLink href="/transfers" label="All" />}>
      <ListSurface>
        {transfers.map((transfer) => (
          <ListRow
            key={transfer.id}
            href={`/players/${transfer.playerId}`}
            leading={<TeamCrest crestUrl={transfer.toTeamCrestUrl} name={transfer.toTeamName ?? ""} size={24} />}
            title={transfer.playerName}
            subtitle={
              transfer.fromTeamName && transfer.toTeamName
                ? `${transfer.fromTeamName} → ${transfer.toTeamName}`
                : (transfer.toTeamName ?? transfer.fromTeamName ?? TRANSFER_TYPE_LABEL[transfer.typeKey])
            }
            trailing={
              <span className="flex flex-col items-end">
                <span className="text-xs font-medium text-foreground-muted">
                  {TRANSFER_TYPE_LABEL[transfer.typeKey]}
                </span>
                <span className="text-xs text-foreground-subtle">{transfer.dateLabel}</span>
              </span>
            }
          />
        ))}
      </ListSurface>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Fantasy                                                              */
/* ------------------------------------------------------------------ */

/**
 * Fantasy points and rank.
 *
 * Each number is omitted rather than zeroed when it isn't real: points only
 * exist once a gameweek has been scored, a rank only once the league
 * leaderboard has scores in it, and the deadline countdown only while the
 * deadline is genuinely in the future. `<StatGrid>` has no null handling by
 * design, so the caller has to make that call — which is this block deciding
 * what it actually knows rather than a formatter printing an em dash.
 */
export function FantasySection({
  summary,
  deadlineAt,
  rosterConfirmed,
  gameweekNumber,
  now,
}: {
  summary: FantasySummary;
  deadlineAt: string | null;
  rosterConfirmed: boolean;
  gameweekNumber: number | null;
  now: number;
}) {
  const countdown = deadlineAt ? formatDurationUntil(deadlineAt, now) : null;
  const hasDeadline = Boolean(countdown && gameweekNumber !== null);
  const stats =
    (summary.latestPoints !== null ? 1 : 0) + (summary.rank !== null ? 1 : 0) + (hasDeadline ? 1 : 0);

  return (
    <Section
      title="Fantasy"
      description={summary.leagueName ? `${summary.teamName} · ${summary.leagueName}` : summary.teamName}
      action={<SectionLink href="/fantasy" label="Open" />}
    >
      {stats > 0 ? (
        <StatGrid columns={stats === 1 ? 2 : 3}>
          {summary.latestPoints !== null && (
            <StatBlock
              label={summary.latestGameweekNumber !== null ? `GW${summary.latestGameweekNumber} points` : "Last scored"}
              value={summary.latestPoints}
            />
          )}
          {summary.rank !== null && (
            <StatBlock
              label="League rank"
              value={summary.entriesRanked !== null ? `${summary.rank}/${summary.entriesRanked}` : summary.rank}
            />
          )}
          {hasDeadline && (
            <StatBlock
              // Short enough to sit on one line in a three-column grid at
              // 390px; the gameweek number is in the countdown's own label
              // when the squad is in, and the warning is the point when it
              // is not.
              label={rosterConfirmed ? `GW${gameweekNumber} locks` : "squad not in"}
              value={countdown}
              tone={rosterConfirmed ? "default" : "accent"}
            />
          )}
        </StatGrid>
      ) : (
        // A team that exists but has never been scored and has no deadline
        // ahead of it. One row back into the game, rather than a grid of
        // nothing — `<StatGrid>` with no stats in it is exactly the "—" the
        // primitives contract forbids.
        <ListSurface>
          <ListRow href="/fantasy" chevron title={summary.teamName} subtitle={summary.leagueName} />
        </ListSurface>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Predictions                                                          */
/* ------------------------------------------------------------------ */

/**
 * Predictions: what is still open, and the run.
 *
 * A streak of zero produces no block — the section itself is only on the page
 * when there is either an open call or a live run, so this never renders a row
 * of noughts.
 */
export function PredictionsSection({ summary, now }: { summary: PredictionSummary; now: number }) {
  const locksIn = summary.nextLockAt ? formatDurationUntil(summary.nextLockAt, now) : null;
  const blocks =
    (summary.openCount > 0 ? 1 : 0) + (summary.currentStreak > 0 ? 1 : 0) + (summary.scoredCount > 0 ? 1 : 0);

  return (
    <Section
      title="Your calls"
      // The lock time is a fact, so it goes here rather than being crammed into
      // a column label that then wraps to three lines on a phone.
      description={summary.openCount > 0 && locksIn ? `Next locks in ${locksIn}` : null}
      action={<SectionLink href="/predictions/mine" label="Open" />}
    >
      <StatGrid columns={blocks <= 2 ? 2 : 3}>
        {summary.openCount > 0 && <StatBlock label="still open" value={summary.openCount} />}
        {summary.currentStreak > 0 && (
          <StatBlock label="in a row" value={summary.currentStreak} tone="accent" />
        )}
        {summary.scoredCount > 0 && (
          <StatBlock label="called right" value={`${summary.correctCount}/${summary.scoredCount}`} />
        )}
      </StatGrid>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Followed players                                                     */
/* ------------------------------------------------------------------ */

/** The players this viewer follows. A player whose club has no synced upcoming
 * fixture shows their club and nothing else, rather than a placeholder date. */
export function FollowedPlayersSection({ players }: { players: FollowedPlayer[] }) {
  return (
    <Section title="Your players" action={<SectionLink href="/profile/following" label="Manage" />}>
      <ListSurface>
        {players.map((player) => (
          <ListRow
            key={player.id}
            href={`/players/${player.id}`}
            leading={<PlayerAvatar photoUrl={player.photoUrl} name={player.name} size={32} />}
            title={player.name}
            subtitle={[player.position, player.teamName].filter(Boolean).join(" · ")}
            trailing={player.nextFixture ? `v ${player.nextFixture.opponentName}` : undefined}
          />
        ))}
      </ListSurface>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Followed competitions                                                */
/* ------------------------------------------------------------------ */

/**
 * The competitions this viewer follows, as a rail.
 *
 * A rail rather than a list because these are destinations rather than news —
 * the same reason `RecentlyViewedStrip` is one. Until this pass a competition
 * follow reached /home not at all: the page's follow query filtered
 * `followed_type` down to team and player, so starring the Premier League on
 * /matches left no trace on the screen the app opens on.
 */
export function CompetitionsRail({ competitions }: { competitions: FollowedCompetition[] }) {
  return (
    <Section title="Your competitions" action={<SectionLink href="/leagues" label="All" />}>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:-mx-8 lg:px-8">
        {competitions.map((competition) => (
          <Link
            key={competition.id}
            href={`/leagues/${competition.id}`}
            // Sized to its own name rather than to a fixed width: "LaLiga" and
            // "UEFA Champions League" are both real competitions and neither
            // should be abbreviated to fit a grid.
            className="kivo-glass-sharp kivo-focus flex min-h-11 max-w-[15rem] shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-2"
          >
            <CompetitionLogo logoUrl={competition.logoUrl} name={competition.name} size={24} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-foreground">{competition.name}</span>
              {/* Two facts, in preference order, and nothing at all when
                  neither is known. `competitions.country` is null on most
                  synced rows — see CompetitionGroupHeader for why that renders
                  as absence rather than as "International". */}
              {competition.todayCount > 0 ? (
                <span className="truncate text-xs text-accent">
                  {competition.todayCount} {competition.todayCount === 1 ? "match" : "matches"} today
                </span>
              ) : (
                competition.country && (
                  <span className="truncate text-xs text-foreground-subtle">{competition.country}</span>
                )
              )}
            </span>
          </Link>
        ))}
      </div>
    </Section>
  );
}
