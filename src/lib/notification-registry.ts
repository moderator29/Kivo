import {
  ArrowLeftRight,
  Award,
  Bell,
  Goal,
  MessageCircle,
  Radio,
  ShieldAlert,
  Target,
  Timer,
  Trophy,
  Users,
  UserPlus,
  Heart,
  type LucideIcon,
} from "lucide-react";
import type { NotificationRow } from "@/lib/notifications";

/**
 * `notifications.type` is free text in the schema (see the comment on the
 * column in supabase/migrations/0001_kivo_core_schema.sql: "notification
 * types will grow continuously as features ship"), not a Postgres enum — so
 * this union is KIVO's own registry of every type a producer emits or is
 * reasonably expected to emit next, not a mirror of a DB constraint.
 * "post_like"/"post_comment"/"comment_reply" (src/app/(app)/social/actions.ts
 * and comment-actions.ts), "new_follower" (src/app/(app)/follow-actions.ts),
 * and "match_kickoff"/"match_goal"/"match_red_card"/"match_result"/
 * "player_event" (src/lib/football/match-notifications.ts, wired into the
 * real sync code paths in sync.ts/sync-match-details.ts) are all wired to
 * real producers; prediction/fantasy/badge/moderation types below are still
 * forward-covered only, so describe()/icon()/href() never fall back to a raw
 * snake_case string once those ship a producer too. Add new types here first.
 */
export type NotificationType =
  | "post_like"
  | "post_comment"
  | "comment_reply"
  | "new_follower"
  | "match_kickoff"
  | "match_goal"
  | "match_red_card"
  | "match_result"
  | "player_event"
  | "transfer_recorded"
  | "prediction_result"
  | "prediction_reminder"
  | "fantasy_deadline"
  | "fantasy_points"
  | "fantasy_roster_carried"
  | "badge_earned"
  | "moderation_outcome";

type Payload = Record<string, unknown>;

function str(payload: Payload, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function actorName(payload: Payload, prefix: string): string {
  return str(payload, `${prefix}_display_name`) || str(payload, `${prefix}_username`) || "Someone";
}

/**
 * Where a post actually lives: the general `/social` feed, or a fixture's
 * Room tab in Match Centre when the post carries `posts.fixture_id` (see
 * src/components/matches/match-room.tsx). `tab=room` is read by
 * MatchCentreTabs to open straight on the Room tab.
 *
 * RECOMMENDATIONS item 237: this used to append `#post-<id>`, a plain DOM
 * fragment that only ever worked if the post already happened to be on the
 * first page of whatever pagination the target list had loaded — a post
 * further back than that simply had no matching element to scroll to, and
 * the jump silently did nothing. `?post=<id>` instead is a real query param
 * both `/social` (posts.ts's `fetchPostsPage`) and this fixture's Room tab
 * read server-side to explicitly fetch and prepend that exact post if it
 * isn't already in the page they'd normally load — see SocialPage and
 * MatchCentrePage. The client then only has to scroll to an id that's
 * guaranteed to already be in the DOM, never search pagination for it.
 */
function postHref(payload: Payload): string {
  const postId = str(payload, "post_id");
  const fixtureId = str(payload, "fixture_id");
  const query = postId ? `?post=${encodeURIComponent(postId)}` : "";
  return fixtureId
    ? `/matches/${fixtureId}?tab=room${postId ? `&post=${encodeURIComponent(postId)}` : ""}`
    : `/social${query}`;
}

function fixtureHref(payload: Payload): string {
  const fixtureId = str(payload, "fixture_id");
  return fixtureId ? `/matches/${fixtureId}` : "/matches";
}

interface RegistryEntry {
  title: (payload: Payload) => string;
  icon: LucideIcon;
  href: (payload: Payload) => string;
}

export const NOTIFICATION_REGISTRY: Record<NotificationType, RegistryEntry> = {
  post_like: {
    title: (p) => `${actorName(p, "liker")} liked your post`,
    icon: Heart,
    href: postHref,
  },
  post_comment: {
    title: (p) => `${actorName(p, "commenter")} commented on your post`,
    icon: MessageCircle,
    href: postHref,
  },
  comment_reply: {
    title: (p) => `${actorName(p, "replier")} replied to your comment`,
    icon: MessageCircle,
    href: postHref,
  },
  new_follower: {
    title: (p) => `${actorName(p, "follower")} started following you`,
    icon: UserPlus,
    href: (p) => {
      const username = str(p, "follower_username");
      return username ? `/u/${username}` : "/notifications";
    },
  },
  match_kickoff: {
    title: (p) => str(p, "summary") ?? "A match you're following kicks off soon",
    icon: Radio,
    href: fixtureHref,
  },
  match_goal: {
    title: (p) => str(p, "summary") ?? "Goal in a match you're following",
    icon: Goal,
    href: fixtureHref,
  },
  match_red_card: {
    title: (p) => str(p, "summary") ?? "Red card in a match you're following",
    icon: ShieldAlert,
    href: fixtureHref,
  },
  match_result: {
    title: (p) => str(p, "summary") ?? "Full time in a match you're following",
    icon: Trophy,
    href: fixtureHref,
  },
  player_event: {
    title: (p) => str(p, "summary") ?? "A player you follow was involved in a match event",
    icon: Target,
    href: fixtureHref,
  },
  // Transfer follow alerts (src/lib/football/transfer-notifications.ts), fired
  // from the transfer sync's insert branch. Links to the move itself rather
  // than the list, because "who is this about" is the whole question.
  transfer_recorded: {
    title: (p) => str(p, "summary") ?? "A transfer was recorded for someone you follow",
    icon: ArrowLeftRight,
    href: (p) => {
      const transferId = str(p, "transfer_id");
      return transferId ? `/transfers/${transferId}` : "/transfers";
    },
  },
  prediction_result: {
    title: (p) => str(p, "summary") ?? "One of your predictions was settled",
    icon: Target,
    href: () => "/predictions",
  },
  prediction_reminder: {
    title: (p) => str(p, "summary") ?? "A prediction deadline is approaching",
    icon: Timer,
    href: () => "/predictions",
  },
  fantasy_deadline: {
    title: (p) => str(p, "summary") ?? "Your fantasy gameweek deadline is approaching",
    icon: Timer,
    href: () => "/fantasy",
  },
  fantasy_points: {
    title: (p) => str(p, "summary") ?? "Your fantasy points were updated",
    icon: Trophy,
    href: () => "/fantasy",
  },
  // KN-61: KIVO can now score a squad its owner never confirmed (scoring
  // carries the last one forward, item 17's second half), so the product owes
  // that owner an actual message rather than a badge on a screen they would
  // have to think to open.
  fantasy_roster_carried: {
    title: (p) => str(p, "summary") ?? "Your fantasy squad was carried forward",
    icon: Users,
    href: () => "/fantasy",
  },
  badge_earned: {
    title: (p) => {
      const name = str(p, "badge_name");
      return name ? `You earned the "${name}" badge` : "You earned a new badge";
    },
    icon: Award,
    href: () => "/rewards",
  },
  moderation_outcome: {
    title: (p) => str(p, "summary") ?? "A report you filed was reviewed",
    icon: ShieldAlert,
    href: () => "/social",
  },
};

function isKnownType(type: string): type is NotificationType {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_REGISTRY, type);
}

function payloadOf(notification: Pick<NotificationRow, "payload">): Payload {
  return (notification.payload ?? {}) as Payload;
}

/** Human-readable line for a notification. Falls back to a humanized version
 * of the raw type string for anything not yet in the registry above, instead
 * of ever throwing on an unrecognized value from the free-text `type` column. */
export function describeNotification(notification: Pick<NotificationRow, "type" | "payload">): string {
  if (isKnownType(notification.type)) return NOTIFICATION_REGISTRY[notification.type].title(payloadOf(notification));
  return notification.type.replace(/_/g, " ");
}

/** Icon for a notification's type; a generic bell for anything unregistered. */
export function notificationIcon(notification: Pick<NotificationRow, "type">): LucideIcon {
  return isKnownType(notification.type) ? NOTIFICATION_REGISTRY[notification.type].icon : Bell;
}

/** Target URL for a notification's click-through; the notifications list
 * itself for anything unregistered (never a dead click). */
export function notificationHref(notification: Pick<NotificationRow, "type" | "payload">): string {
  if (isKnownType(notification.type)) return NOTIFICATION_REGISTRY[notification.type].href(payloadOf(notification));
  return "/notifications";
}

/**
 * Coarse groups over the type union above, used by `/notifications`' filter
 * chips (KN-48).
 *
 * The taxonomy already existed — every type has a title, an icon and an href —
 * and was used for nothing but rendering one flat reverse-chronological list.
 * A user with match alerts on for three clubs has a bell that is overwhelmingly
 * goals, and the social replies they actually want to answer are buried under
 * them.
 *
 * Grouped rather than one chip per type on purpose: fifteen chips is a second
 * navigation problem, and nobody thinks "show me only red cards". These are
 * the five things a person actually comes to this page looking for. Every type
 * in `NotificationType` must appear in exactly one group — `NOTIFICATION_GROUP_OF`
 * below is derived from this list, so a new type that is never added here is
 * simply unreachable by filter rather than silently mis-grouped.
 */
export const NOTIFICATION_GROUPS = [
  {
    id: "matches",
    label: "Matches",
    types: ["match_kickoff", "match_goal", "match_red_card", "match_result", "player_event"],
  },
  {
    id: "transfers",
    label: "Transfers",
    types: ["transfer_recorded"],
  },
  {
    id: "social",
    label: "Social",
    types: ["post_like", "post_comment", "comment_reply", "new_follower"],
  },
  {
    id: "predictions",
    label: "Predictions",
    types: ["prediction_result", "prediction_reminder"],
  },
  {
    id: "fantasy",
    label: "Fantasy",
    types: ["fantasy_deadline", "fantasy_points", "fantasy_roster_carried"],
  },
  {
    id: "you",
    label: "You",
    types: ["badge_earned", "moderation_outcome"],
  },
] as const satisfies readonly { id: string; label: string; types: readonly NotificationType[] }[];

export type NotificationGroupId = (typeof NOTIFICATION_GROUPS)[number]["id"];

/** Narrowing for a `?type=` search param, so an unknown or hand-typed value
 * falls back to "everything" rather than filtering the list down to nothing. */
export function notificationGroup(id: string | undefined): (typeof NOTIFICATION_GROUPS)[number] | null {
  if (!id) return null;
  return NOTIFICATION_GROUPS.find((group) => group.id === id) ?? null;
}
