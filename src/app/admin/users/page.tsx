import { Lock, Info } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { canViewUserData } from "@/lib/admin";
import { FadeIn } from "@/components/ui/fade-in";

export default async function AdminUsersPage() {
  const profile = await getOrCreateProfile();

  if (!canViewUserData(profile?.role)) {
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
      .select("id, username, display_name, role, created_at")
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

      {/* Read-only by design, not by omission: there's no ban/suspend/role-change
          column or RLS policy backing a mutation here yet, so this is a deliberate
          "not yet implemented" note rather than a silent gap. */}
      <FadeIn delay={0.05} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-2.5 text-xs text-foreground-subtle">
        <Info className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        This table is read-only. Ban, suspend and role-change actions aren&apos;t built yet.
      </FadeIn>

      <FadeIn delay={0.08} className="kivo-glass-brand overflow-x-auto rounded-2xl">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/5 text-xs uppercase tracking-wide text-foreground-subtle">
              <th className="px-4 py-3 font-medium">Username</th>
              <th className="px-4 py-3 font-medium">Display name</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((user) => (
              <tr key={user.id} className="border-b border-white/5 transition-colors last:border-0 hover:bg-white/[0.03]">
                <td className="px-4 py-3 text-foreground">{user.username}</td>
                <td className="px-4 py-3 text-foreground-muted">{user.display_name ?? "-"}</td>
                <td className="px-4 py-3 text-foreground-muted">{user.role}</td>
                <td className="px-4 py-3 text-foreground-muted">
                  {new Date(user.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {(!users || users.length === 0) && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-foreground-muted">
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
