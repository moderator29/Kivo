import { Search, Users, X } from "lucide-react";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readList } from "@/lib/query-result";
import { LoadFailed } from "@/components/ui/load-failed";
import { getOrCreateProfile } from "@/lib/profile";
import { canViewUserData } from "@/lib/admin";
import { FadeIn } from "@/components/ui/fade-in";
import { UserModerationControls } from "@/components/admin/user-moderation-controls";
import { AdminPageHeader, AdminAccessNotice } from "@/components/admin/admin-chrome";
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
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${badgeClass}`}
    >
      {role.replace(/_/g, " ")}
    </span>
  );
}

const USER_ROW_LIMIT = 100;

/**
 * PostgREST parses `or=(a.ilike.*x*,b.ilike.*x*)` positionally, so a comma or a
 * bracket typed into the search box would be read as filter syntax rather than
 * as text. Rather than guess at an escaping scheme, the query is restricted to
 * the characters a KIVO username or display name can actually contain, and the
 * page says what it dropped is nothing it could have matched anyway.
 */
function sanitiseQuery(raw: string): string {
  return raw.replace(/[^\p{L}\p{N} _'-]/gu, "").trim().slice(0, 40);
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const profile = await getOrCreateProfile();

  if (!profile || !canViewUserData(profile.role)) {
    return (
      <AdminAccessNotice
        title="Users"
        role={profile?.role}
        subject="User data"
        because="`profiles` is readable in full only by the admin and super-admin roles (profiles_select_admin, migration 0001)."
      />
    );
  }

  const rawQuery = await searchParams;
  const queryParam = Array.isArray(rawQuery.q) ? rawQuery.q[0] : rawQuery.q;
  const query = sanitiseQuery(queryParam ?? "");

  const supabase = createServerSupabaseClient();
  const columns =
    "id, username, display_name, role, created_at, moderation_status, moderation_reason, moderation_expires_at";

  // The list is capped at 100. Without a way to look past that cap, an admin
  // with more than a hundred accounts simply could not reach account 101 — the
  // page had no dead end more obvious than that, and no way out of it.
  const listQuery = supabase.from("profiles").select(columns).order("created_at", { ascending: false });
  const [usersResult, { count: totalCount }] = await Promise.all([
    query
      ? listQuery.or(`username.ilike.%${query}%,display_name.ilike.%${query}%`).limit(USER_ROW_LIMIT)
      : listQuery.limit(USER_ROW_LIMIT),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
  ]);

  // An admin reads this table to answer "who is on KIVO". An empty one is a
  // real answer on a new deployment, which is exactly what makes a failed
  // read dangerous here: it reports zero users to the one person whose job is
  // to notice that something is wrong.
  const usersOutcome = readList(usersResult, "admin.users");
  const users = usersOutcome.rows;
  const shownCount = users.length;
  const total = totalCount ?? shownCount;

  const lede = query
    ? `Accounts matching “${query}”, newest first.`
    : total > shownCount
      ? `Showing the ${shownCount} most recently joined of ${total}. Search to reach the rest.`
      : `${total} account${total === 1 ? "" : "s"}, most recently joined first.`;

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader icon={Users} title="Users" lede={lede} />

      <FadeIn delay={0.05} className="flex flex-col gap-2">
        <form method="get" role="search" className="flex items-center gap-2">
          <label htmlFor="user-search" className="sr-only">
            Search accounts by username or display name
          </label>
          <div className="relative flex min-w-0 flex-1 items-center">
            <Search
              className="pointer-events-none absolute left-3 h-4 w-4 text-foreground-subtle"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <input
              id="user-search"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Username or display name"
              autoComplete="off"
              className="kivo-focusable h-11 w-full rounded-xl border border-hairline bg-surface-1 pl-9 pr-3 text-sm text-foreground placeholder:text-foreground-subtle"
            />
          </div>
          <button
            type="submit"
            className="kivo-focusable h-11 shrink-0 rounded-xl bg-surface-2 px-4 text-sm font-semibold text-foreground transition hover:bg-surface-1"
          >
            Search
          </button>
        </form>
        {query && (
          <Link
            href="/admin/users"
            className="kivo-focusable inline-flex min-h-9 w-fit items-center gap-1 rounded-lg text-xs font-medium text-foreground-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            Clear search
          </Link>
        )}
      </FadeIn>

      {usersOutcome.failed ? (
        <LoadFailed
          tone="section"
          title="The user list"
          description="KIVO couldn't read the profiles table. This is not the same as there being no users — try again."
        />
      ) : users.length === 0 ? (
        <FadeIn delay={0.08} className="kivo-glass rounded-2xl p-8 text-center text-sm text-foreground-muted">
          {query
            ? `No account's username or display name contains “${query}”. This searched all ${total} accounts, not just the hundred listed by default.`
            : "No accounts yet. This is a real empty table, not a failed read."}
        </FadeIn>
      ) : (
        <>
          {/* Below md the table became a horizontal scroller with five columns
              and an action cluster in the last one — on a 390px phone, which is
              where this founder actually opens Admin, the moderation controls
              were off-screen entirely and nothing indicated they existed. One
              card per account instead, with the same controls. */}
          <FadeIn delay={0.08} className="flex flex-col gap-2 md:hidden">
            {users.map((user) => (
              <div key={user.id} className="kivo-glass flex flex-col gap-3 rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{user.username}</p>
                    <p className="truncate text-xs text-foreground-subtle">
                      {user.display_name ?? "No display name"} · joined{" "}
                      {formatDate(user.created_at, { month: "short" })}
                    </p>
                  </div>
                  <RoleCell role={user.role} />
                </div>
                <UserModerationControls
                  targetProfileId={user.id}
                  targetUsername={user.username}
                  status={effectiveModerationStatus(user.moderation_status, user.moderation_expires_at)}
                  reason={user.moderation_reason}
                  expiresAt={user.moderation_expires_at}
                  isViewerOwnRow={user.id === profile.id}
                />
              </div>
            ))}
          </FadeIn>

          <FadeIn delay={0.08} className="kivo-glass-brand hidden overflow-x-auto rounded-2xl md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-hairline-soft text-xs uppercase tracking-wide text-foreground-subtle">
                  <th className="px-4 py-3 font-medium">Username</th>
                  <th className="px-4 py-3 font-medium">Display name</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Joined</th>
                  <th className="px-4 py-3 font-medium">Moderation</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr
                    key={user.id}
                    className="border-b border-hairline-soft transition-colors last:border-0 hover:bg-surface-2"
                  >
                    <td className="px-4 py-3 font-medium text-foreground">{user.username}</td>
                    <td className="px-4 py-3 text-foreground-muted">{user.display_name ?? "-"}</td>
                    <td className="px-4 py-3">
                      <RoleCell role={user.role} />
                    </td>
                    <td className="px-4 py-3 text-foreground-muted">
                      {formatDate(user.created_at, { month: "short" })}
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
              </tbody>
            </table>
          </FadeIn>
        </>
      )}
    </div>
  );
}
