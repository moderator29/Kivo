import { ShieldAlert, History } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { QueryFailedError, readList } from "@/lib/query-result";
import { getOrCreateProfile } from "@/lib/profile";
import { canViewModerationData } from "@/lib/admin";
import { FadeIn } from "@/components/ui/fade-in";
import { staggerDelay } from "@/lib/stagger";
import { ReportRow, type ReportPreview } from "@/components/admin/report-row";
import { AdminPageHeader, AdminSection, AdminAccessNotice } from "@/components/admin/admin-chrome";
import type { Database } from "@/lib/supabase/types";

type ModerationTargetType = Database["public"]["Enums"]["moderation_target_type"];

/**
 * Item 46 (RECOMMENDATIONS.md): resolves the real reported content for the
 * open reports on this page, server-side, so ReportRow never has to guess.
 * Live target rows win (a post can be edited after it's reported, and the
 * queue should show what a moderator would actually see if they clicked
 * through); `content_snapshot` — captured at report-creation time, see
 * supabase/migrations/0022_report_content_snapshot.sql — is the fallback for
 * a target that's already been deleted. Neither present means the "content
 * no longer available" state in ReportRow, never a placeholder.
 */
async function resolvePreviews(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  reports: {
    id: string;
    target_type: ModerationTargetType;
    target_id: string;
    content_snapshot: Database["public"]["Tables"]["reports"]["Row"]["content_snapshot"];
  }[],
): Promise<Map<string, ReportPreview>> {
  const postIds = reports.filter((r) => r.target_type === "post").map((r) => r.target_id);
  const commentIds = reports.filter((r) => r.target_type === "comment").map((r) => r.target_id);
  const profileIds = reports.filter((r) => r.target_type === "profile").map((r) => r.target_id);

  const [postsResult, commentsResult, profilesResult] = await Promise.all([
    postIds.length
      ? supabase
          .from("posts")
          .select("id, body, author:profiles!posts_author_profile_id_fkey(username, display_name)")
          .in("id", postIds)
      : Promise.resolve({ data: [] as never[], error: null }),
    commentIds.length
      ? supabase
          .from("comments")
          .select("id, body, author:profiles!comments_author_profile_id_fkey(username, display_name)")
          .in("id", commentIds)
      : Promise.resolve({ data: [] as never[], error: null }),
    profileIds.length
      ? supabase.from("profiles").select("id, username, display_name, bio").in("id", profileIds)
      : Promise.resolve({ data: [] as never[], error: null }),
  ]);

  // These three decide whether each queued report is shown as live content or
  // as a snapshot of something already deleted. A failed read used to resolve
  // to "not found", which this function then reports as `live: false` — so a
  // moderator would be told the post they are judging has already been taken
  // down, when it is still up and still visible to everyone.
  //
  // There is no honest partial answer here, so this throws to the route's
  // error boundary rather than rendering a queue whose liveness column is
  // quietly wrong. A moderation queue that admits it could not load is
  // strictly better than one that mislabels what it is showing.
  const postsOutcome = readList(postsResult, "admin.moderation.posts");
  const commentsOutcome = readList(commentsResult, "admin.moderation.comments");
  const profilesOutcome = readList(profilesResult, "admin.moderation.profiles");

  if (postsOutcome.failed || commentsOutcome.failed || profilesOutcome.failed) {
    throw new QueryFailedError(
      "admin.moderation.previews",
      "could not read the reported content, so live and already-deleted cannot be told apart",
    );
  }

  const postById = new Map(postsOutcome.rows.map((p) => [p.id, p]));
  const commentById = new Map(commentsOutcome.rows.map((c) => [c.id, c]));
  const profileById = new Map(profilesOutcome.rows.map((p) => [p.id, p]));

  const previews = new Map<string, ReportPreview>();

  for (const report of reports) {
    if (report.target_type === "post") {
      const live = postById.get(report.target_id);
      if (live) {
        previews.set(report.id, {
          kind: "post",
          body: live.body,
          authorUsername: live.author?.username ?? null,
          authorDisplayName: live.author?.display_name ?? null,
          live: true,
        });
        continue;
      }
    } else if (report.target_type === "comment") {
      const live = commentById.get(report.target_id);
      if (live) {
        previews.set(report.id, {
          kind: "comment",
          body: live.body,
          authorUsername: live.author?.username ?? null,
          authorDisplayName: live.author?.display_name ?? null,
          live: true,
        });
        continue;
      }
    } else {
      const live = profileById.get(report.target_id);
      if (live) {
        previews.set(report.id, {
          kind: "profile",
          username: live.username,
          displayName: live.display_name,
          bio: live.bio,
          live: true,
        });
        continue;
      }
    }

    // Live target is gone (already deleted) — fall back to the snapshot
    // captured at report-creation time, if one exists.
    const snapshot = report.content_snapshot as Record<string, unknown> | null;
    if (snapshot && typeof snapshot === "object") {
      if (snapshot.type === "post") {
        previews.set(report.id, {
          kind: "post",
          body: String(snapshot.body ?? ""),
          authorUsername: (snapshot.author_username as string | null) ?? null,
          authorDisplayName: (snapshot.author_display_name as string | null) ?? null,
          live: false,
        });
        continue;
      }
      if (snapshot.type === "comment") {
        previews.set(report.id, {
          kind: "comment",
          body: String(snapshot.body ?? ""),
          authorUsername: (snapshot.author_username as string | null) ?? null,
          authorDisplayName: (snapshot.author_display_name as string | null) ?? null,
          live: false,
        });
        continue;
      }
      if (snapshot.type === "profile") {
        previews.set(report.id, {
          kind: "profile",
          username: (snapshot.username as string | null) ?? null,
          displayName: (snapshot.display_name as string | null) ?? null,
          bio: (snapshot.bio as string | null) ?? null,
          live: false,
        });
        continue;
      }
    }

    previews.set(report.id, null);
  }

  return previews;
}

export default async function ModerationPage() {
  const profile = await getOrCreateProfile();

  if (!canViewModerationData(profile?.role)) {
    return (
      <AdminAccessNotice
        title="Moderation"
        role={profile?.role}
        subject="The moderation queue"
        because="`reports` is readable only by the moderator, content-admin, support-admin, admin and super-admin roles (can_moderate(), migration 0001)."
      />
    );
  }

  const supabase = createServerSupabaseClient();
  const OPEN_REPORT_LIMIT = 50;
  const [{ data: openReports }, { count: openReportTotal }, { data: resolvedReports }] = await Promise.all([
    supabase
      .from("reports")
      .select(
        "id, target_type, target_id, reason, created_at, content_snapshot, reporter:profiles!reports_reporter_profile_id_fkey(username)",
      )
      .in("status", ["pending", "reviewing"])
      // Oldest first — the report that's waited longest is the highest-priority
      // triage item (SLA-aware ordering), not just newest-first noise.
      .order("created_at", { ascending: true })
      .limit(OPEN_REPORT_LIMIT),
    supabase.from("reports").select("id", { count: "exact", head: true }).in("status", ["pending", "reviewing"]),
    supabase
      .from("reports")
      .select("id, target_type, status, resolved_at, reporter:profiles!reports_reporter_profile_id_fkey(username)")
      .in("status", ["actioned", "dismissed"])
      .order("resolved_at", { ascending: false })
      .limit(10),
  ]);
  const shownOpenCount = openReports?.length ?? 0;
  const totalOpenCount = openReportTotal ?? shownOpenCount;

  // Item 46: resolve every open report's actual reported content up front so
  // ReportRow can render a real preview instead of asking moderators to
  // decide blind.
  const previewsById = openReports ? await resolvePreviews(supabase, openReports) : new Map<string, ReportPreview>();

  return (
    <div className="flex flex-col gap-8">
      <AdminPageHeader
        icon={ShieldAlert}
        title="Moderation"
        lede={
          totalOpenCount > shownOpenCount
            ? `Showing ${shownOpenCount} of ${totalOpenCount} open reports, oldest first.`
            : `${totalOpenCount} open report${totalOpenCount === 1 ? "" : "s"}, oldest first.`
        }
        cost="Reported content stays visible to everyone until somebody acts on it. Each row shows what was actually reported, and whether it is still live."
      />

      {!openReports || openReports.length === 0 ? (
        <FadeIn delay={0.08} className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-10 text-center">
          <ShieldAlert className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
          <p className="text-sm text-foreground-muted">No reports yet. The queue is clear.</p>
        </FadeIn>
      ) : (
        <div className="flex flex-col gap-2">
          {openReports.map((report, index) => (
            <FadeIn key={report.id} delay={0.08 + staggerDelay(index, 0.03)}>
              <ReportRow
                id={report.id}
                targetType={report.target_type}
                reason={report.reason}
                reporterUsername={report.reporter?.username ?? "unknown"}
                createdAt={report.created_at}
                preview={previewsById.get(report.id) ?? null}
              />
            </FadeIn>
          ))}
        </div>
      )}

      {resolvedReports && resolvedReports.length > 0 && (
        <AdminSection icon={History} title="Recently resolved" delay={0.55}>
          <div className="flex flex-col gap-2">
            {resolvedReports.map((report, index) => (
              <FadeIn
                key={report.id}
                delay={0.6 + staggerDelay(index, 0.03)}
                className="flex items-center justify-between rounded-xl border border-hairline-soft px-4 py-3 text-xs text-foreground-subtle transition-colors hover:bg-surface-2"
              >
                <span>
                  {report.target_type} reported by {report.reporter?.username ?? "unknown"}
                </span>
                <span className="uppercase tracking-wide">{report.status}</span>
              </FadeIn>
            ))}
          </div>
        </AdminSection>
      )}
    </div>
  );
}
