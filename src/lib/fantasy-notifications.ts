import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { buildNotification } from "@/lib/notification-payloads";
import { filterNotifiable } from "@/lib/notification-preferences";
import { logError } from "@/lib/log";

type ServiceClient = SupabaseClient<Database>;

/**
 * The two fantasy notifications KIVO owed its managers (KN-61).
 *
 * The gap this closes is specific and slightly uncomfortable: `scoreFantasyGameweek`
 * carries a squad forward for a team whose owner never opened the app for that
 * gameweek (RECOMMENDATIONS item 17's second half), and then scores it. So a
 * user could be scored on a squad they never confirmed and find out only if
 * they happened to open `/fantasy` and read a badge. The infrastructure to tell
 * them was already complete — `notifications`, the registry, `fantasy_alerts_enabled`
 * and `shouldNotify`/`filterNotifiable` — everything except a producer.
 *
 * Design decisions worth stating:
 *
 * - **One notification per owner per scoring run.** A carried-forward squad
 *   that also scored says both things in one line rather than firing twice for
 *   what is, to the user, one event.
 * - **The lazy path stays silent.** `carryForwardFantasyRoster` runs when the
 *   owner is looking at `/fantasy`, and it already shows a "Carried forward
 *   from GW{N}" badge right there. Notifying somebody about a change they are
 *   currently watching happen is noise.
 * - **Preferences are honoured**, via `filterNotifiable` on
 *   `fantasy_alerts_enabled` — batched, not one lookup per manager.
 * - **Best-effort.** A failed notification insert never fails the scoring run
 *   that produced it; the points are the real work, this is the telling.
 */

export type FantasyScoringNotice = {
  ownerProfileId: string;
  gameweekNumber: number;
  /** Null when this owner's team scored nothing at all this gameweek — they
   * still get told their squad was carried, which is the more surprising fact
   * of the two. */
  points: number | null;
  /** The gameweek the squad was carried from, when this run carried it. */
  carriedFromGameweekNumber: number | null;
};

function summarize(notice: FantasyScoringNotice): string {
  const gw = `Gameweek ${notice.gameweekNumber}`;
  if (notice.points !== null && notice.carriedFromGameweekNumber !== null) {
    return `${gw}: your squad from Gameweek ${notice.carriedFromGameweekNumber} was kept and scored ${notice.points} ${notice.points === 1 ? "point" : "points"}.`;
  }
  if (notice.points !== null) {
    return `${gw}: your squad scored ${notice.points} ${notice.points === 1 ? "point" : "points"}.`;
  }
  return `${gw}: you hadn't picked a squad, so we kept your Gameweek ${notice.carriedFromGameweekNumber} one.`;
}

/**
 * Writes one notification per manager for a scoring run. Silently does nothing
 * for an empty list, and skips anyone who has turned fantasy alerts off.
 */
export async function notifyFantasyGameweekOutcome(
  service: ServiceClient,
  notices: FantasyScoringNotice[],
): Promise<{ notified: number }> {
  const relevant = notices.filter((n) => n.points !== null || n.carriedFromGameweekNumber !== null);
  if (relevant.length === 0) return { notified: 0 };

  const allowed = new Set(
    await filterNotifiable(
      service,
      relevant.map((n) => n.ownerProfileId),
      "fantasy_alerts_enabled",
    ),
  );

  const rows = relevant
    .filter((n) => allowed.has(n.ownerProfileId))
    .map((n) => {
      const summary = summarize(n);
      // The type follows what the notification is *about*: a squad that scored
      // is a points notification even if it was also carried; a squad that was
      // only carried is a carry notification. Both land on /fantasy.
      return n.points !== null
        ? buildNotification(n.ownerProfileId, "fantasy_points", {
            gameweek_number: n.gameweekNumber,
            points: n.points,
            summary,
          })
        : buildNotification(n.ownerProfileId, "fantasy_roster_carried", {
            gameweek_number: n.gameweekNumber,
            carried_from_gameweek_number: n.carriedFromGameweekNumber as number,
            summary,
          });
    });

  if (rows.length === 0) return { notified: 0 };

  const { error } = await service.from("notifications").insert(rows);
  if (error) {
    logError("fantasy.notifyGameweekOutcome", error, { count: rows.length });
    return { notified: 0 };
  }
  return { notified: rows.length };
}
