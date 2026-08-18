import type { Database } from "./supabase/types";

export type ModerationStatus = Database["public"]["Enums"]["moderation_status"];

/**
 * Client/display-side mirror of private.effective_moderation_status()
 * (supabase/migrations/0045_moderation_status.sql). Deliberately duplicated
 * logic, not a shared source of truth: this is read-only and cosmetic
 * (what a page renders), never the enforcement decision itself — every
 * actual write is still gated by the real RLS function running in Postgres,
 * regardless of what this returns. Used wherever a moderation_status column
 * pulled straight from `profiles` needs to reflect an elapsed suspension
 * without a round trip (the admin users table, the viewer's own restriction
 * banner) — a suspension whose moderation_expires_at has already passed
 * reads as "active" here even before anything has lazily healed the stored
 * row, same as the real RLS-facing function does.
 */
export function effectiveModerationStatus(status: ModerationStatus, expiresAt: string | null): ModerationStatus {
  if (status === "suspended" && expiresAt && new Date(expiresAt).getTime() <= Date.now()) return "active";
  return status;
}
