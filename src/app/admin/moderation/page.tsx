import { ShieldAlert } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function ModerationPage() {
  const supabase = createServerSupabaseClient();
  const { data: reports } = await supabase
    .from("reports")
    .select("id, target_type, reason, status, created_at, reporter:profiles!reports_reporter_profile_id_fkey(username)")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Moderation queue</h1>
        <p className="text-sm text-foreground-muted">Reports awaiting review, newest first.</p>
      </div>

      {!reports || reports.length === 0 ? (
        <div className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-10 text-center">
          <ShieldAlert className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
          <p className="text-sm text-foreground-muted">No reports yet — the queue is clear.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {reports.map((report) => (
            <div key={report.id} className="kivo-glass flex items-center justify-between rounded-xl p-4">
              <div>
                <p className="text-sm text-foreground">
                  <span className="font-medium">{report.target_type}</span> reported by{" "}
                  {report.reporter?.username ?? "unknown"}
                </p>
                <p className="text-xs text-foreground-muted">{report.reason}</p>
              </div>
              <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
                {report.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
