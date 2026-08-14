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
