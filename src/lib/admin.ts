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

export function hasAdminAccess(role: UserRole | undefined | null): boolean {
  return !!role && ADMIN_ROLES.includes(role);
}
