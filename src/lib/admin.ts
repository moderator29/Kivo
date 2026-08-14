import "server-only";
import type { Database } from "./supabase/types";

type UserRole = Database["public"]["Enums"]["user_role"];

const ADMIN_ROLES: UserRole[] = [
  "super_admin",
  "admin",
  "moderator",
  "football_data_admin",
  "content_admin",
  "support_admin",
  "analyst",
];

/** Roles the `can_moderate()`/`is_admin()` RLS policies actually grant visibility
 * to on reports/profiles — kept in sync with supabase/migrations/0001 by hand
 * since Postgres role checks aren't introspectable from here. A role outside
 * this set can still reach /admin (it may have real access elsewhere, e.g.
 * football_data_admin on Data Health), but moderation/user data will be
 * silently empty via RLS — pages using this must say so, not show a fake
 * "all clear" empty state. */
const MODERATION_VISIBLE_ROLES: UserRole[] = ["moderator", "admin", "super_admin", "content_admin", "support_admin"];

export function hasAdminAccess(role: UserRole | undefined | null): boolean {
  return !!role && ADMIN_ROLES.includes(role);
}

export function canViewModerationData(role: UserRole | undefined | null): boolean {
  return !!role && MODERATION_VISIBLE_ROLES.includes(role);
}

/** Matches `private.is_admin()` in supabase/migrations/0001 — the only two
 * roles the `profiles_select_admin` RLS policy actually grants visibility to. */
const USER_DATA_VISIBLE_ROLES: UserRole[] = ["admin", "super_admin"];

export function canViewUserData(role: UserRole | undefined | null): boolean {
  return !!role && USER_DATA_VISIBLE_ROLES.includes(role);
}
