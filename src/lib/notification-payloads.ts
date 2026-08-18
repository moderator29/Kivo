import type { Json } from "@/lib/supabase/types";
import type { NotificationType } from "@/lib/notification-registry";

/**
 * The shape of `notifications.payload`, as a discriminated union (KN-90).
 *
 * The column is untyped jsonb and five producers were writing five different
 * shapes into it, each independently, each correct only by convention.
 * `notification-registry.ts` reads them all with optional chaining and
 * fallbacks — which is exactly right for *rendering* (a payload from an older
 * release must still render) and exactly wrong as the only guarantee. A
 * producer that quietly stopped including `post_id` still wrote a perfectly
 * valid row; the notification rendered looking completely normal and its link
 * went nowhere.
 *
 * Two independent guards now, and they are deliberately not the same guard
 * twice. This union is the compile-time one: a producer cannot construct a
 * payload missing a required field, and adding a field to a type is a type
 * error at every site that builds it. Migration 0061's check constraint is the
 * runtime one, for anything that reaches the table another way.
 *
 * Optional fields are optional because they are genuinely sometimes absent —
 * `fixture_id` on a social notification is null for a post outside a Match
 * Room, and `display_name` is null for an account that has not set one. They
 * are not "we might remember to include it".
 */

type SocialActorFields<Prefix extends string> = {
  [K in `${Prefix}_username`]: string;
} & {
  [K in `${Prefix}_display_name`]: string | null;
};

/** A post the notification links to. `fixture_id` present and non-null means
 * the post lives in that fixture's Match Room, which changes the destination —
 * see `postHref` in notification-registry.ts. */
type PostTarget = {
  post_id: string;
  fixture_id: string | null;
};

export type NotificationPayloadByType = {
  post_like: PostTarget & SocialActorFields<"liker">;
  post_comment: PostTarget & SocialActorFields<"commenter">;
  comment_reply: PostTarget & SocialActorFields<"replier">;
  new_follower: SocialActorFields<"follower">;
  /** Match notifications carry a summary line built at produce time, because
   * the renderer has no access to the fixture's teams or score. */
  match_kickoff: { fixture_id: string; summary: string };
  match_result: { fixture_id: string; summary: string };
  match_goal: { fixture_id: string; summary: string; player_id: string | null };
  match_red_card: { fixture_id: string; summary: string; player_id: string | null };
  player_event: { fixture_id: string; summary: string; player_id: string | null };
  /** KN-61. Both fantasy payloads carry a pre-built summary for the same
   * reason the match ones do: the renderer has no access to a gameweek number
   * or a points total, and reconstructing either at read time would mean a
   * query per notification in the list. */
  fantasy_points: { gameweek_number: number; points: number; summary: string };
  fantasy_roster_carried: {
    gameweek_number: number;
    carried_from_gameweek_number: number;
    summary: string;
  };
};

/** The types that actually have a producer today. The rest of
 * `NotificationType` is forward coverage in the registry so the UI never falls
 * back to a raw snake_case string — those get a payload type here when they
 * get a producer, not before. */
export type ProducedNotificationType = keyof NotificationPayloadByType;

/**
 * Builds a `notifications` insert row with its payload type-checked against
 * its `type`.
 *
 * The `Json` cast at the end is unavoidable and is the whole reason this
 * function exists: supabase-js types the column as `Json`, which accepts
 * anything, so the checking has to happen *before* that boundary. Every
 * producer goes through here so that check is never skipped.
 */
export function buildNotification<T extends ProducedNotificationType>(
  profileId: string,
  type: T,
  payload: NotificationPayloadByType[T],
): NotificationInsert {
  return { profile_id: profileId, type, payload: payload as unknown as Json };
}

/**
 * The insert row this returns. `type` is widened back to `string` on the way
 * out on purpose: the pairing of type and payload is already enforced by the
 * generic above, at the call site, which is where a mistake is actually made.
 * Keeping the literal type here instead would make a producer that branches
 * between two notification types (see `notifyComment`) produce a union of two
 * incompatible row shapes that supabase-js's insert overloads reject — a
 * type error about nothing, in exchange for no additional safety.
 */
export type NotificationInsert = { profile_id: string; type: string; payload: Json };

// Compile-time assertion, not a runtime one: every key of the payload map must
// be a real NotificationType. If a producer type is renamed in the registry and
// not here, this line stops the build rather than letting a notification ship
// that the registry cannot describe, icon or link.
type _ProducedTypesAreRegistered = ProducedNotificationType extends NotificationType ? true : never;
const _producedTypesAreRegistered: _ProducedTypesAreRegistered = true;
void _producedTypesAreRegistered;
