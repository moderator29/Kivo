import { Lock } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { canViewUserData } from "@/lib/admin";
import { FadeIn } from "@/components/ui/fade-in";
import { UserModerationControls } from "@/components/admin/user-moderation-controls";
import { effectiveModerationStatus } from "@/lib/moderation";
import type { Database } from "@/lib/supabase/types";

type UserRole = Database["public"]["Enums"]["user_role"];

// A flat text role column gave every row identical visual weight — scanning
// for who actually has elevated access meant reading every cell. "user" (the
// overwhelming majority of rows) stays plain text so it doesn't compete for
// attention; every role that grants some form of elevated access gets a
// small pill, colour-coded by how broad that access is (critical for the two
// full-access roles, cyan for the narrower scoped-admin roles, muted for
// moderator). Real enum values only (see user_role above) — nothing here
// invents a role that isn't in the schema.
const ROLE_BADGE_STYLE: Partial<Record<UserRole, string>> = {
  super_admin: "border-critical/30 bg-critical/10 text-critical",
  admin: "border-critical/30 bg-critical/10 text-critical",
  football_data_admin: "border-kivo-cyan/30 bg-kivo-cyan/10 text-kivo-cyan",
  content_admin: "border-kivo-cyan/30 bg-kivo-cyan/10 text-kivo-cyan",
  support_admin: "border-kivo-cyan/30 bg-kivo-cyan/10 text-kivo-cyan",
  analyst: "border-kivo-cyan/30 bg-kivo-cyan/10 text-kivo-cyan",
  moderator: "border-white/15 bg-white/[0.06] text-foreground-muted",
};

function RoleCell({ role }: { role: UserRole }) {
  const badgeClass = ROLE_BADGE_STYLE[role];
  if (!badgeClass) return <span className="text-foreground-muted">{role}</span>;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${badgeClass}`}>
      {role.replace(/_/g, " ")}
    </span>
  );
}

export default async function AdminUsersPage() {
  const profile = await getOrCreateProfile();

  if (!profile || !canViewUserData(profile.role)) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold text-foreground">Users</h1>
        <div className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-10 text-center">
          <Lock className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
          <p className="text-sm text-foreground-muted">
            User data isn&apos;t part of your role (<span className="text-foreground">{profile?.role}</span>).
            This isn&apos;t an empty list, it&apos;s outside what your access covers.
          </p>
        </div>
      </div>
    );
  }

  const supabase = createServerSupabaseClient();
  const USER_ROW_LIMIT = 100;
  const [{ data: users }, { count: totalCount }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, username, display_name, role, created_at, moderation_status, moderation_reason, moderation_expires_at")
      .order("created_at", { ascending: false })
      .limit(USER_ROW_LIMIT),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
  ]);
  const shownCount = users?.length ?? 0;
  const total = totalCount ?? shownCount;

  return (
    <div className="flex flex-col gap-6">
      <FadeIn>
        <h1 className="text-xl font-semibold text-foreground">Users</h1>
        <p className="text-sm text-foreground-muted">
          {total > shownCount
            ? `Showing ${shownCount} of ${total}, most recently joined first.`
            : "Most recently joined, newest first."}
        </p>
      </FadeIn>

      <FadeIn delay={0.08} className="kivo-glass-brand overflow-x-auto rounded-2xl">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/5 text-xs uppercase tracking-wide text-foreground-subtle">
              <th className="px-4 py-3 font-medium">Username</th>
              <th className="px-4 py-3 font-medium">Display name</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3 font-medium">Moderation</th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((user) => (
              <tr key={user.id} className="border-b border-white/5 transition-colors last:border-0 hover:bg-white/[0.03]">
                <td className="px-4 py-3 font-medium text-foreground">{user.username}</td>
                <td className="px-4 py-3 text-foreground-muted">{user.display_name ?? "-"}</td>
                <td className="px-4 py-3">
                  <RoleCell role={user.role} />
                </td>
                <td className="px-4 py-3 text-foreground-muted">
                  {new Date(user.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <UserModerationControls
                    targetProfileId={user.id}
                    targetUsername={user.username}
                    status={effectiveModerationStatus(user.moderation_status, user.moderation_expires_at)}
                    reason={user.moderation_reason}
                    expiresAt={user.moderation_expires_at}
                    isViewerOwnRow={user.id === profile.id}
                  />
                </td>
              </tr>
            ))}
            {(!users || users.length === 0) && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-foreground-muted">
                  No users yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </FadeIn>
    </div>
  );
}
