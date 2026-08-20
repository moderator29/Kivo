import "server-only";
import type { Database } from "./supabase/types";
import { ADMIN_NAV, type AdminCapability } from "./admin-nav";

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

/** Matches the football-reference-table write policies (`*_insert_admin` /
 * `*_update_admin` / `*_delete_admin`) and the `provider_mappings_all_admin` /
 * `sync_runs_all_admin` policies in supabase/migrations/0001 — the only roles
 * that can write football data or see sync history. */
const FOOTBALL_DATA_MANAGE_ROLES: UserRole[] = ["football_data_admin", "admin", "super_admin"];

export function canManageFootballData(role: UserRole | undefined | null): boolean {
  return !!role && FOOTBALL_DATA_MANAGE_ROLES.includes(role);
}

/** Matches `support_requests_select_admin` / `support_requests_update_admin`
 * in supabase/migrations/0055 — the roles that can read and triage inbound
 * help requests. Deliberately excludes 'moderator': content moderation and
 * account support are different jobs with different data, and a support
 * request routinely contains an email address a content moderator has no
 * reason to see. */
const SUPPORT_ROLES: UserRole[] = ["support_admin", "admin", "super_admin"];

export function canHandleSupport(role: UserRole | undefined | null): boolean {
  return !!role && SUPPORT_ROLES.includes(role);
}

/** Matches `audit_log_select_admin` in supabase/migrations/0001, whose USING
 * clause is `private.is_admin()` — the same two roles as `canViewUserData`, and
 * deliberately a separate predicate rather than a reuse of it. They answer
 * different questions ("can you see other people's profile rows" vs. "can you
 * read the sensitive-action trail"), they are enforced by two different
 * policies, and either one could be widened without the other. A shared
 * predicate would silently widen both.
 *
 * `audit_log` is append-only by design (no update or delete policy exists,
 * including for admins), so this is the only access the table has beyond the
 * inserts `logAudit` makes with the service-role key. */
const AUDIT_LOG_VISIBLE_ROLES: UserRole[] = ["admin", "super_admin"];

export function canViewAuditLog(role: UserRole | undefined | null): boolean {
  return !!role && AUDIT_LOG_VISIBLE_ROLES.includes(role);
}

/**
 * Who may read platform-health figures that RLS cannot gate.
 *
 * `ai_conversations` and `ai_messages` carry exactly one policy each —
 * `ai_conversations_all_own` / `ai_messages_all_own`, migration 0001 — scoped to
 * the conversation's owner, with no admin override of any kind. There is no
 * "admins may read AI usage" policy to mirror, and adding one would widen access
 * to the message *content*, which is the last thing an operator needs in order
 * to answer "is the Copilot being abused".
 *
 * So /admin/ai counts through the service-role client, and this predicate is
 * therefore **the entire boundary** rather than a restatement of one enforced
 * underneath it. That is why it is the narrowest set in this file and why it is
 * not folded into `canViewUserData` despite currently holding the same two
 * roles: those two lists would have to be widened for different reasons, and a
 * shared constant would widen both at once.
 */
const PLATFORM_HEALTH_ROLES: UserRole[] = ["admin", "super_admin"];

export function canViewPlatformHealth(role: UserRole | undefined | null): boolean {
  return !!role && PLATFORM_HEALTH_ROLES.includes(role);
}

/**
 * The admin pages this role can actually use, as plain href strings.
 *
 * ADMIN IA PASS 2026-08-19. The nav used to list every page to every admin
 * role, and the pages a role could not use answered with a lock screen. With
 * one football page that was a fair trade — with four of them, a moderator's
 * nav advertised four dead ends. Resolving the capability here rather than in
 * the nav module keeps one source of truth for what each role can see: the
 * same predicates the pages themselves gate on, above.
 *
 * Returned as strings specifically so a Server Component can hand the result
 * to the two "use client" nav components — see the header of
 * `src/lib/admin-nav.ts` for why anything richer cannot cross that boundary.
 *
 * The lock screens stay. This hides a link; it never becomes the authorization
 * check, which is the page's own gate plus RLS underneath it.
 */
export function permittedAdminNavHrefs(role: UserRole | undefined | null): string[] {
  const allows: Record<AdminCapability, boolean> = {
    any: true,
    football: canManageFootballData(role),
    moderation: canViewModerationData(role),
    users: canViewUserData(role),
    support: canHandleSupport(role),
    audit: canViewAuditLog(role),
    platform: canViewPlatformHealth(role),
  };
  return ADMIN_NAV.filter((item) => allows[item.capability]).map((item) => item.href);
}
