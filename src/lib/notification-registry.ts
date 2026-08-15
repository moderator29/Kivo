import {
  Award,
  Bell,
  Goal,
  MessageCircle,
  Radio,
  ShieldAlert,
  Target,
  Timer,
  Trophy,
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
 * "post_like" (src/app/(app)/social/actions.ts), "match_kickoff"/
 * "match_goal"/"match_red_card"/"match_result"/"player_event"
 * (src/lib/football/match-notifications.ts, wired into the real sync code
 * paths in sync.ts/sync-match-details.ts) are wired to real producers;
 * prediction/fantasy/badge/moderation types below are forward-covered so
 * describe()/icon()/href() never fall back to a raw snake_case string once
 * those ship a producer too. Add new types here first.
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
  | "prediction_result"
  | "prediction_reminder"
  | "fantasy_deadline"
  | "fantasy_points"
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
 * src/components/matches/match-room.tsx). `#post-<id>` anchors to the id set
 * on PostCard's root element (src/components/social/post-card.tsx); `tab=room`
 * is read by MatchCentreTabs to open straight on the Room tab.
 */
function postHref(payload: Payload): string {
  const postId = str(payload, "post_id");
  const fixtureId = str(payload, "fixture_id");
  const anchor = postId ? `#post-${postId}` : "";
  return fixtureId ? `/matches/${fixtureId}?tab=room${anchor}` : `/social${anchor}`;
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
