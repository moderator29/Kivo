import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { isGoalEventType, isRedCardEventType, type FixtureEventType } from "./event-labels";
import { logError } from "@/lib/log";

type ServiceClient = SupabaseClient<Database>;

/**
 * RECOMMENDATIONS.md item 254: "System-authored live event posts inside
 * Match Rooms." When a real goal or red card lands via
 * sync-match-details.ts's upsertFixtureEvent, insert a system-authored post
 * into that fixture's Match Room ("⚽ GOAL — Player Name (Team), 67'") —
 * turning the room from something users have to remember to post in
 * themselves into one that's alive automatically, seeded entirely by real,
 * already-synced events. Deliberately its own small module, not folded into
 * match-notifications.ts: that file's whole contract is "writes to
 * `notifications`, no push infra" (see its own doc comment) — this writes to
 * `posts` instead, a different table with different RLS and a different
 * consumer (Match Room's feed, not the bell). Both are called from the same
 * real-insert-only branch of upsertFixtureEvent for the same event, but they
 * stay separate, single-purpose files.
 *
 * See supabase/migrations/0047_match_room_system_posts.sql for the two
 * things that make this safe: a real, permanent "KIVO" profiles row to
 * satisfy posts.author_profile_id's NOT NULL FK (never a fabricated
 * persona), and a `posts.is_system` column that ONLY a service-role write —
 * i.e. only this module — can ever set true (posts_insert_own/
 * posts_update_own reject `is_system = true` from any real authenticated
 * user's own client-side insert/update, so a fan can never dress their own
 * post up as an official KIVO update).
 */

const KIVO_SYSTEM_USERNAME = "kivo_system";

/**
 * Resolves the real KIVO system profile's id once per sync run (mirrors
 * syncFixtureDetails' own `teamNames` map: fetched once up front, threaded
 * through processEvents -> upsertFixtureEvent, rather than re-queried per
 * event). Returns null — never throws — if the seed row is somehow missing
 * in a given environment, so a sync run degrades to "no system posts this
 * run" rather than failing real lineup/event/statistics processing over a
 * decorative feature.
 */
export async function getKivoSystemProfileId(supabase: ServiceClient): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", KIVO_SYSTEM_USERNAME)
    .maybeSingle();
  if (error) {
    logError("football.match-room-system-posts.matchRoomSystemPosts", error);
    return null;
  }
  return data?.id ?? null;
}

function formatMinute(minute: number, addedTime: number | null): string {
  return `${minute}${addedTime ? `+${addedTime}` : ""}'`;
}

export interface SystemEventPostInput {
  fixtureId: string;
  teamName: string;
  eventType: FixtureEventType;
  minute: number;
  addedTime: number | null;
  playerName: string | null;
}

/**
 * Inserts the system Room post for one real fixture event, if (and only if)
 * it's a goal or red card — the same isGoalEventType/isRedCardEventType
 * classification notifyFixtureEvent already uses, so "what counts as a big
 * enough moment to announce" never drifts between the bell and the Room.
 * Called from upsertFixtureEvent's real-insert-only branch, right alongside
 * notifyFixtureEvent — never on the update/dedupe branch, so a re-sync of an
 * already-seen event never posts twice. Failures are logged, not thrown,
 * matching notifyFixtureEvent/insertNotifications' own stance: a decorative
 * side-effect failing must never fail the sync it's attached to.
 */
export async function insertSystemEventPost(
  supabase: ServiceClient,
  systemProfileId: string | null,
  input: SystemEventPostInput,
): Promise<void> {
  if (!systemProfileId) return;

  const isGoal = isGoalEventType(input.eventType);
  const isRedCard = isRedCardEventType(input.eventType);
  if (!isGoal && !isRedCard) return;

  const player = input.playerName ?? "Unknown player";
  const when = formatMinute(input.minute, input.addedTime);
  const body = isGoal
    ? `⚽ GOAL — ${player} (${input.teamName}), ${when}`
    : `🟥 RED CARD — ${player} (${input.teamName}), ${when}`;

  const { error } = await supabase.from("posts").insert({
    author_profile_id: systemProfileId,
    fixture_id: input.fixtureId,
    body,
    is_system: true,
  });
  if (error) logError("football.match-room-system-posts.matchRoomSystemPosts", error);
}
