import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function AdminUsersPage() {
  const supabase = createServerSupabaseClient();
  const { data: users } = await supabase
    .from("profiles")
    .select("id, username, display_name, role, onboarding_completed, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Users</h1>
        <p className="text-sm text-foreground-muted">Most recently joined, newest first.</p>
      </div>

      <div className="kivo-glass overflow-x-auto rounded-2xl">
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
              <tr key={user.id} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3 text-foreground">{user.username}</td>
                <td className="px-4 py-3 text-foreground-muted">{user.display_name ?? "—"}</td>
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
      </div>
    </div>
  );
}
