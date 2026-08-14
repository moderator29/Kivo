import { ShieldAlert, Lock, History } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { canViewModerationData } from "@/lib/admin";
import { FadeIn } from "@/components/ui/fade-in";
import { ReportRow } from "@/components/admin/report-row";

export default async function ModerationPage() {
  const profile = await getOrCreateProfile();

  if (!canViewModerationData(profile?.role)) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold text-foreground">Moderation queue</h1>
        <div className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-10 text-center">
          <Lock className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
          <p className="text-sm text-foreground-muted">
            Moderation isn&apos;t part of your role (<span className="text-foreground">{profile?.role}</span>).
            This isn&apos;t an empty queue, it&apos;s outside what your access covers.
          </p>
        </div>
      </div>
    );
  }

  const supabase = createServerSupabaseClient();
  const [{ data: openReports }, { data: resolvedReports }] = await Promise.all([
    supabase
      .from("reports")
      .select("id, target_type, reason, created_at, reporter:profiles!reports_reporter_profile_id_fkey(username)")
      .in("status", ["pending", "reviewing"])
      // Oldest first — the report that's waited longest is the highest-priority
      // triage item (SLA-aware ordering), not just newest-first noise.
      .order("created_at", { ascending: true })
      .limit(50),
    supabase
      .from("reports")
      .select("id, target_type, status, resolved_at, reporter:profiles!reports_reporter_profile_id_fkey(username)")
      .in("status", ["actioned", "dismissed"])
      .order("resolved_at", { ascending: false })
      .limit(10),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <FadeIn>
        <h1 className="text-xl font-semibold text-foreground">Moderation queue</h1>
        <p className="text-sm text-foreground-muted">
          {openReports?.length ?? 0} open report{openReports?.length === 1 ? "" : "s"}, oldest first.
        </p>
      </FadeIn>

      {!openReports || openReports.length === 0 ? (
        <FadeIn delay={0.08} className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-10 text-center">
          <ShieldAlert className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
          <p className="text-sm text-foreground-muted">No reports yet. The queue is clear.</p>
        </FadeIn>
      ) : (
        <div className="flex flex-col gap-2">
          {openReports.map((report, index) => (
            <FadeIn key={report.id} delay={Math.min(0.08 + index * 0.03, 0.5)}>
              <ReportRow
                id={report.id}
                targetType={report.target_type}
                reason={report.reason}
                reporterUsername={report.reporter?.username ?? "unknown"}
                createdAt={report.created_at}
              />
            </FadeIn>
          ))}
        </div>
      )}

      {resolvedReports && resolvedReports.length > 0 && (
        <div className="flex flex-col gap-3">
          <FadeIn delay={0.55}>
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
              <History className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />
              Recently resolved
            </h2>
          </FadeIn>
          <div className="flex flex-col gap-2">
            {resolvedReports.map((report, index) => (
              <FadeIn
                key={report.id}
                delay={Math.min(0.6 + index * 0.03, 0.85)}
                className="flex items-center justify-between rounded-xl border border-white/5 px-4 py-3 text-xs text-foreground-subtle transition-colors hover:bg-white/[0.03]"
              >
                <span>
                  {report.target_type} reported by {report.reporter?.username ?? "unknown"}
                </span>
                <span className="uppercase tracking-wide">{report.status}</span>
              </FadeIn>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
