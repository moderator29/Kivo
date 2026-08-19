import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { logError } from "@/lib/log";
import { quietUntil, type QuietHoursWindow } from "@/lib/quiet-hours";
import { breaksThroughQuietHours } from "@/lib/notification-registry";

// The 8 boolean columns on notification_preferences, matching
// supabase/migrations/0001_kivo_core_schema.sql exactly. Kept as a const
// allow-list so updateNotificationPreference (src/app/(app)/settings/actions.ts)
// can never be pointed at an arbitrary column via a crafted client call.
//
// Lives outside actions.ts because a "use server" file may only export async
// functions — these plain constants/types have to live in a regular module.
export const NOTIFICATION_PREFERENCE_COLUMNS = [
  "email_enabled",
  "push_enabled",
  "in_app_enabled",
  "marketing_emails_enabled",
  "match_alerts_enabled",
  "social_alerts_enabled",
  "prediction_alerts_enabled",
  "fantasy_alerts_enabled",
] as const;

export type NotificationPreferenceColumn = (typeof NOTIFICATION_PREFERENCE_COLUMNS)[number];

// Mirrors each column's `default` in the migration, used whenever the caller
// has no notification_preferences row yet (nothing has ever been saved).
export const NOTIFICATION_PREFERENCE_DEFAULTS: Record<NotificationPreferenceColumn, boolean> = {
  email_enabled: true,
  push_enabled: true,
  in_app_enabled: true,
  marketing_emails_enabled: false,
  match_alerts_enabled: true,
  social_alerts_enabled: true,
  prediction_alerts_enabled: true,
  fantasy_alerts_enabled: true,
};

/**
 * RECOMMENDATIONS.md item 285: every real notification producer
 * (src/lib/football/match-notifications.ts, src/app/(app)/social/actions.ts,
 * social/comment-actions.ts, follow-actions.ts) used to insert straight into
 * `notifications` with zero check against this table — flipping a toggle off
 * in Settings changed nothing about what a user actually received. This is
 * the shared per-recipient gate every one of those producers now calls right
 * before it would otherwise write a row.
 *
 * Always additionally requires `in_app_enabled`: in-app is the *only*
 * delivery channel any producer writes to today (no email/push infra — see
 * `notification_deliveries`' own "no producer yet" note, item 11) — so a
 * category toggle being on can't matter if the one channel that actually
 * exists is itself off. Once a real second channel ships, this should become
 * channel-aware instead of this blanket fold-in.
 *
 * Same literal column list as getNotificationPreferences
 * (src/app/(app)/settings/actions.ts) for the same reason noted there — a
 * literal select string is what lets supabase-js infer a real per-column
 * boolean type, which building the string from `column` dynamically could
 * not. Takes the caller's own client rather than creating one, matching
 * every function in match-notifications.ts — every real call site here is
 * checking someone ELSE's preferences (the recipient, essentially never the
 * signed-in actor), so callers must pass a service-role client:
 * `notification_preferences_all_own` scopes a session-scoped client's reads
 * to `private.current_profile_id()` only and would silently return zero rows
 * for anyone else's id (read as "no row yet", not as "blocked").
 */
export async function shouldNotify(
  supabase: SupabaseClient<Database>,
  profileId: string,
  column: NotificationPreferenceColumn,
): Promise<boolean> {
  const { data } = await supabase
    .from("notification_preferences")
    .select(
      "email_enabled, push_enabled, in_app_enabled, marketing_emails_enabled, match_alerts_enabled, social_alerts_enabled, prediction_alerts_enabled, fantasy_alerts_enabled",
    )
    .eq("profile_id", profileId)
    .maybeSingle();

  const prefs = data ?? NOTIFICATION_PREFERENCE_DEFAULTS;
  return prefs.in_app_enabled && prefs[column];
}

/**
 * Batched form of `shouldNotify`, for producers with a real audience rather
 * than a single recipient (KIVO_NEXT_GEN KN-9).
 *
 * `insertNotifications` (src/lib/football/match-notifications.ts) used to map
 * `shouldNotify` over every recipient, so one goal for a club with N followers
 * fired N concurrent single-row selects from inside a running sync, before a
 * single notification row was written. The file's own comment argued that
 * matched its "simplicity over scale" trade-off, which was fair when the
 * product had no followers — it stops being fair the first time a popular club
 * does, and the shape degrades exactly when the platform is busiest (a live
 * match, every producer firing at once).
 *
 * Absent rows default open, identically to `shouldNotify`: a user who has never
 * touched Settings has no `notification_preferences` row, and the defaults in
 * `NOTIFICATION_PREFERENCE_DEFAULTS` mirror the migration's own column
 * defaults. Missing from the result set therefore means "hasn't set a
 * preference", never "opted out".
 *
 * Chunked because the ids travel in a URL-encoded PostgREST `in.(...)` filter,
 * and an audience is unbounded by nature — the same failure mode KN-15
 * describes for /home's follow filter, avoided here up front rather than
 * discovered at some particular follower count. Returns ids in input order.
 */
const PREFERENCE_LOOKUP_CHUNK_SIZE = 300;

export async function filterNotifiable(
  supabase: SupabaseClient<Database>,
  profileIds: Iterable<string>,
  column: NotificationPreferenceColumn,
): Promise<string[]> {
  const ids = Array.from(new Set(profileIds));
  if (ids.length === 0) return [];

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += PREFERENCE_LOOKUP_CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + PREFERENCE_LOOKUP_CHUNK_SIZE));
  }

  const blocked = new Set<string>();
  await Promise.all(
    chunks.map(async (chunk) => {
      const { data, error } = await supabase
        .from("notification_preferences")
        .select(
          "profile_id, email_enabled, push_enabled, in_app_enabled, marketing_emails_enabled, match_alerts_enabled, social_alerts_enabled, prediction_alerts_enabled, fantasy_alerts_enabled",
        )
        .in("profile_id", chunk);

      if (error) {
        // Fail closed for this chunk rather than notifying people who may have
        // opted out: an unreadable preference is not consent. Logged, not
        // thrown, so one bad chunk can't abort a whole sync's fan-out.
        logError("notification-preferences.filternotifiablePreferenceLookupSkipping", error);
        for (const id of chunk) blocked.add(id);
        return;
      }

      for (const row of data ?? []) {
        if (!(row.in_app_enabled && row[column])) blocked.add(row.profile_id);
      }
    }),
  );

  return ids.filter((id) => !blocked.has(id));
}


/* ---------------------------------------------------------------------------
   QUIET HOURS (migration 0088)

   The preference gate above answers "may this person be notified at all". This
   answers the next question: "should this one interrupt them right now".

   The two are resolved together, in the same query, deliberately. They are read
   at the same moment by the same producers over the same audience, and a
   separate lookup per recipient is exactly the shape KN-9 removed from this
   file once already.
--------------------------------------------------------------------------- */

export type NotifiableRecipient = {
  profileId: string;
  /**
   * The instant this recipient's current quiet window ends, or null when they
   * are not in one. Copied onto `notifications.quiet_until` by the producer —
   * unless the notification's type breaks through (see
   * `breaksThroughQuietHours`), in which case the producer passes null.
   */
  quietUntil: string | null;
};

/**
 * `filterNotifiable`, plus each survivor's quiet-hours answer.
 *
 * Same chunking, same fail-closed behaviour, same "absent row means defaults,
 * which means notify" rule — a user who has never opened Settings has no
 * preference row, and quiet hours default to off, so they are never silenced
 * by a row that does not exist.
 *
 * The timezone comes from `profiles.timezone` and is frequently null, because
 * KIVO never infers one from an IP address. `quietUntil` handles that by
 * returning null: a quiet window with no zone to interpret it in is not a
 * window, and applying UTC to a user in Lagos would hold their notifications
 * back by the wrong hour.
 */
export async function resolveNotifiableRecipients(
  supabase: SupabaseClient<Database>,
  profileIds: Iterable<string>,
  column: NotificationPreferenceColumn,
  now: Date = new Date(),
): Promise<NotifiableRecipient[]> {
  const allowed = await filterNotifiable(supabase, profileIds, column);
  if (allowed.length === 0) return [];

  const windowByProfile = new Map<string, QuietHoursWindow>();

  const chunks: string[][] = [];
  for (let i = 0; i < allowed.length; i += PREFERENCE_LOOKUP_CHUNK_SIZE) {
    chunks.push(allowed.slice(i, i + PREFERENCE_LOOKUP_CHUNK_SIZE));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      const [{ data: prefs, error: prefsError }, { data: profiles, error: profilesError }] = await Promise.all([
        supabase
          .from("notification_preferences")
          .select("profile_id, quiet_hours_enabled, quiet_hours_start, quiet_hours_end")
          .in("profile_id", chunk),
        supabase.from("profiles").select("id, timezone").in("id", chunk),
      ]);

      if (prefsError || profilesError) {
        // Fails OPEN, unlike filterNotifiable, and the difference is
        // deliberate: an unreadable preference is not consent to notify, but an
        // unreadable quiet-hours window is only a reason not to *delay* — and
        // delaying a badge on a guess is a worse failure than showing it.
        logError("notification-preferences.resolveQuietHours", prefsError ?? profilesError);
        return;
      }

      const timeZoneById = new Map((profiles ?? []).map((row) => [row.id, row.timezone]));
      for (const row of prefs ?? []) {
        windowByProfile.set(row.profile_id, {
          enabled: row.quiet_hours_enabled,
          start: row.quiet_hours_start,
          end: row.quiet_hours_end,
          timeZone: timeZoneById.get(row.profile_id) ?? null,
        });
      }
    }),
  );

  return allowed.map((profileId) => {
    const window = windowByProfile.get(profileId);
    const until = window ? quietUntil(window, now) : null;
    return { profileId, quietUntil: until?.toISOString() ?? null };
  });
}


/**
 * The quiet-hours stamp for one already-cleared recipient.
 *
 * The three social producers each check `shouldNotify` and then insert a
 * single row, so they need the second half of the answer without redoing the
 * first. Returns the row unchanged when the recipient is not in a quiet
 * window, or when the notification's type is high enough priority to ignore
 * one — which is what makes this safe to call unconditionally.
 */
export async function withQuietHours<T extends { profile_id: string; type: string }>(
  supabase: SupabaseClient<Database>,
  row: T,
  column: NotificationPreferenceColumn,
  now: Date = new Date(),
): Promise<T & { quiet_until?: string | null }> {
  if (breaksThroughQuietHours(row.type)) return row;
  const [recipient] = await resolveNotifiableRecipients(supabase, [row.profile_id], column, now);
  return recipient?.quietUntil ? { ...row, quiet_until: recipient.quietUntil } : row;
}
