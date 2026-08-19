import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { logError } from "@/lib/log";

/**
 * Reads over the `blocks` table (migration 0086), and — more importantly —
 * the one place that states which direction of a block each surface is
 * allowed to know about.
 *
 * THE ASYMMETRY IS THE POINT. A block is reciprocal in what it hides and
 * one-sided in who can observe it. `blocks_select_own` means a signed-in
 * caller can only ever read the blocks *they* made. That is deliberate and
 * it constrains this module: nothing here may return "people who blocked
 * me", because a client that could ask that question could deduce a block it
 * was never told about — which is exactly the leak the feature is supposed
 * not to have.
 *
 * So the two halves are enforced in two different places:
 *
 *   the blocker's half   read filtering, here and in RLS, using the caller's
 *                        own rows.
 *   the blocked party's  RLS's `private.blocked_profile_ids()` (SECURITY
 *   half                 DEFINER, `private` schema, never exposed through
 *                        PostgREST) and the produce-time checks below, which
 *                        run under the service-role client.
 *
 * Notifications get both halves, and they are not the same half. New ones are
 * never produced (`blockExistsBetween`, below, called by every social
 * producer). Ones that already existed are filtered out of the *blocker's* own
 * list at read time — which is safe precisely because it happens on the side
 * that made the block and is unobservable from the other side. The blocked
 * party's own list is left exactly as it was, because deleting rows out of
 * someone else's notifications is a visible event on their account, and a
 * block must never be an event anyone else can see.
 */

type AnyClient = SupabaseClient<Database>;

/** The profiles the caller has blocked. Their own rows only — see above. */
export async function getBlockedProfileIds(): Promise<string[]> {
  const profile = await getOrCreateProfile();
  if (!profile) return [];

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("blocks")
    .select("blocked_profile_id")
    .eq("blocker_profile_id", profile.id);

  if (error) {
    logError("blocks.getBlockedProfileIds", error);
    return [];
  }
  return (data ?? []).map((row) => row.blocked_profile_id);
}

export type BlockedProfile = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarSrc: string | null;
  createdAt: string;
};

/**
 * The caller's block list, with real names attached, for the Settings screen.
 *
 * Goes through `get_public_profiles` rather than joining `profiles` directly
 * for the reason that RPC exists at all: `profiles` is not openly selectable,
 * and this is the same narrow, already-public projection every other
 * name-resolving surface in KIVO uses.
 */
export async function getBlockedProfiles(): Promise<BlockedProfile[]> {
  const profile = await getOrCreateProfile();
  if (!profile) return [];

  const supabase = createServerSupabaseClient();
  const { data: rows, error } = await supabase
    .from("blocks")
    .select("blocked_profile_id, created_at")
    .eq("blocker_profile_id", profile.id)
    .order("created_at", { ascending: false });

  if (error) {
    logError("blocks.getBlockedProfiles", error);
    return [];
  }
  const blocked = rows ?? [];
  if (blocked.length === 0) return [];

  const { data: profiles } = await supabase.rpc("get_public_profiles", {
    p_ids: blocked.map((row) => row.blocked_profile_id),
  });
  const byId = new Map((profiles ?? []).map((row) => [row.id, row]));

  return blocked.map((row) => {
    const target = byId.get(row.blocked_profile_id);
    return {
      id: row.blocked_profile_id,
      username: target?.username ?? null,
      displayName: target?.display_name ?? null,
      // An account KIVO can no longer resolve still stays on the list with a
      // null name rather than silently vanishing — the block is still real,
      // and quietly dropping it would un-block someone without saying so.
      avatarSrc: null,
      createdAt: row.created_at,
    };
  });
}

/** Whether the caller has blocked this one profile. Used by the profile page
 * to render Block vs Unblock — never used to tell anyone they were blocked. */
export async function viewerHasBlocked(targetProfileId: string): Promise<boolean> {
  const profile = await getOrCreateProfile();
  if (!profile) return false;

  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from("blocks")
    .select("id")
    .eq("blocker_profile_id", profile.id)
    .eq("blocked_profile_id", targetProfileId)
    .maybeSingle();
  return data !== null;
}

/**
 * The produce-time gate, in BOTH directions, for a service-role caller.
 *
 * Every social notification producer calls this before writing. It is the
 * counterpart to the RLS read filter: the filter stops a blocked person's
 * words reaching a reader, and this stops a blocked person's *actions*
 * reaching them as a bell. Without it, blocking someone still lets them
 * appear at the top of your notifications every time they like something.
 *
 * Both directions, because the notification producer runs on behalf of the
 * actor and writes onto the recipient: either party having blocked the other
 * is reason enough not to write the row.
 *
 * Fails closed. An unreadable `blocks` table means KIVO cannot show that a
 * block does not exist, and the cost of wrongly suppressing one notification
 * is far smaller than the cost of delivering one somebody blocked.
 */
export async function blockExistsBetween(
  service: AnyClient,
  profileA: string,
  profileB: string,
): Promise<boolean> {
  if (profileA === profileB) return false;

  const { data, error } = await service
    .from("blocks")
    .select("id")
    .or(
      `and(blocker_profile_id.eq.${profileA},blocked_profile_id.eq.${profileB}),` +
        `and(blocker_profile_id.eq.${profileB},blocked_profile_id.eq.${profileA})`,
    )
    .limit(1);

  if (error) {
    logError("blocks.blockExistsBetween", error);
    return true;
  }
  return (data ?? []).length > 0;
}


/**
 * Usernames of the accounts the caller has blocked, for filtering a
 * notification list.
 *
 * Usernames rather than profile ids because that is what the payloads
 * actually carry: `notifications.payload` stores `<actor>_username` (see
 * notification-payloads.ts) and no actor id, so this is the only join key
 * that exists without a schema change and a backfill of every historical row.
 * Usernames are unique (`profiles.username`), so the match is exact rather
 * than a heuristic.
 */
export async function blockedActorUsernames(): Promise<Set<string>> {
  const blocked = await getBlockedProfiles();
  return new Set(blocked.map((entry) => entry.username).filter((name): name is string => name !== null));
}

/** The payload keys every social notification uses for its actor. */
const ACTOR_USERNAME_KEYS = ["liker_username", "commenter_username", "replier_username", "follower_username"];

/**
 * True when this notification is about somebody the caller has blocked.
 *
 * Only ever used to drop rows from the blocker's own list. Match notifications
 * and everything else carry none of these keys, so they always pass — a block
 * silences a person, not a football match.
 */
export function notificationIsFromBlockedActor(
  payload: unknown,
  blockedUsernames: Set<string>,
): boolean {
  if (blockedUsernames.size === 0 || payload === null || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  return ACTOR_USERNAME_KEYS.some((key) => {
    const value = record[key];
    return typeof value === "string" && blockedUsernames.has(value);
  });
}
