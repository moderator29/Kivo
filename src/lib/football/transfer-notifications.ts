import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { filterNotifiable } from "@/lib/notification-preferences";
import { buildNotification } from "@/lib/notification-payloads";
import { logError } from "@/lib/log";

/**
 * Transfer follow alerts — the directive's "follow alerts" for the Transfer
 * Centre, wired to the one moment a transfer genuinely becomes news inside
 * KIVO: the sync writing a `transfers` row it has never written before.
 *
 * Deliberately mirrors `match-notifications.ts` rather than inventing a second
 * notification mechanism:
 *
 *   - **Real audience only.** Followers of the player, followers of either
 *     club, and profiles whose favourite club is either side. No "trending",
 *     no interest inference.
 *   - **Only on a genuinely new row.** `upsertTransfer` calls this from its
 *     insert branch and never from its update branch, so re-running a sync
 *     over history KIVO already holds notifies nobody. Without that, the first
 *     transfer sync for a popular player would fire an alert for every move of
 *     his career at once.
 *   - **In-app only.** There is no push infrastructure (see BUILD_STATUS.md),
 *     and this writes the same `notifications` rows every other producer does.
 *
 * ## The preference column, and why it is the blunt one
 *
 * Settings exposes four topic switches — match, social, prediction, fantasy —
 * and there is no transfer column on `notification_preferences`. Adding one is
 * a migration, and schema is another agent's lane tonight, so this gates on
 * `in_app_enabled`: the master in-app switch. The honest consequence is that
 * someone who wants match alerts but not transfer alerts cannot say so yet,
 * and turning transfers off means turning everything off. That is a real gap,
 * logged in RECOMMENDATIONS.md rather than papered over by silently borrowing
 * `match_alerts_enabled`, which would let a "match alerts" toggle control
 * something that is not a match.
 */

type ServiceClient = SupabaseClient<Database>;

export type TransferNotificationInput = {
  transferId: string;
  playerId: string;
  playerName: string;
  fromTeamId: string | null;
  fromTeamName: string | null;
  toTeamId: string | null;
  toTeamName: string | null;
};

async function teamAudience(supabase: ServiceClient, teamId: string): Promise<string[]> {
  const [{ data: favourites }, { data: followers }] = await Promise.all([
    supabase.from("profiles").select("id").eq("favourite_team_id", teamId),
    supabase
      .from("follows")
      .select("follower_profile_id")
      .eq("followed_type", "team")
      .eq("followed_id", teamId)
      .eq("muted", false),
  ]);
  return [...(favourites ?? []).map((row) => row.id), ...(followers ?? []).map((row) => row.follower_profile_id)];
}

async function playerAudience(supabase: ServiceClient, playerId: string): Promise<string[]> {
  const { data: followers } = await supabase
    .from("follows")
    .select("follower_profile_id")
    .eq("followed_type", "player")
    .eq("followed_id", playerId)
    .eq("muted", false);
  return (followers ?? []).map((row) => row.follower_profile_id);
}

/**
 * The one-line summary the notification list renders. Built here because the
 * renderer has no access to club names, exactly as the match producers do it —
 * and it only ever states the ends of the move that KIVO actually resolved.
 * "Left Atalanta" and "Signed for Inter" are both true sentences on their own;
 * "Atalanta to Unknown" is not a sentence anyone should receive.
 */
export function buildTransferSummary(input: TransferNotificationInput): string {
  if (input.fromTeamName && input.toTeamName) {
    return `${input.playerName} has moved from ${input.fromTeamName} to ${input.toTeamName}`;
  }
  if (input.toTeamName) return `${input.playerName} has signed for ${input.toTeamName}`;
  if (input.fromTeamName) return `${input.playerName} has left ${input.fromTeamName}`;
  return `${input.playerName} has a new transfer on record`;
}

export async function notifyTransferRecorded(
  supabase: ServiceClient,
  input: TransferNotificationInput,
): Promise<void> {
  // Neither end resolved means there is nothing to tell anyone. The row is
  // still stored and still reconcilable later (see
  // reconcileUnresolvedTransferTeams) — it just isn't news yet.
  if (!input.fromTeamId && !input.toTeamId && !input.playerId) return;

  const audiences = await Promise.all([
    playerAudience(supabase, input.playerId),
    input.fromTeamId ? teamAudience(supabase, input.fromTeamId) : Promise.resolve([]),
    input.toTeamId ? teamAudience(supabase, input.toTeamId) : Promise.resolve([]),
  ]);

  // Someone following the player AND both clubs gets one notification, not
  // three.
  const recipients = Array.from(new Set(audiences.flat()));
  if (recipients.length === 0) return;

  const summary = buildTransferSummary(input);
  const rows = (await filterNotifiable(supabase, recipients, "in_app_enabled")).map((profileId) =>
    buildNotification(profileId, "transfer_recorded", {
      transfer_id: input.transferId,
      player_id: input.playerId,
      summary,
    }),
  );
  if (rows.length === 0) return;

  const { error } = await supabase.from("notifications").insert(rows);
  if (error) logError("football.transfer-notifications.insert", error);
}
