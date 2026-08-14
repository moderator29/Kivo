import { Database, Lock, CheckCircle2, XCircle, Loader2, MinusCircle } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { FadeIn } from "@/components/ui/fade-in";
import { FootballSyncButton } from "@/components/admin/football-sync-button";
import type { Database as DatabaseType } from "@/lib/supabase/types";

type SyncStatus = DatabaseType["public"]["Enums"]["sync_status"];

const STATUS_STYLE: Record<SyncStatus, { icon: typeof CheckCircle2; className: string; label: string }> = {
  success: { icon: CheckCircle2, className: "border-live/30 bg-live/10 text-live", label: "Success" },
  partial: { icon: MinusCircle, className: "border-warning/30 bg-warning/10 text-warning", label: "Partial" },
  failed: { icon: XCircle, className: "border-critical/30 bg-critical/10 text-critical", label: "Failed" },
  running: { icon: Loader2, className: "border-white/10 text-foreground-subtle", label: "Running" },
};

function formatTimestamp(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function DataHealthPage() {
  const profile = await getOrCreateProfile();

  if (!canManageFootballData(profile?.role)) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold text-foreground">Data health</h1>
        <div className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-10 text-center">
          <Lock className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
          <p className="text-sm text-foreground-muted">
            Football data isn&apos;t part of your role (<span className="text-foreground">{profile?.role}</span>).
            This isn&apos;t empty, it&apos;s outside what your access covers.
          </p>
        </div>
      </div>
    );
  }

  // Honest per this platform's zero-fake-data rule: the mock provider never counts as
  // "connected" here, even in dev — it exists only so UI can be built without spending
  // API-Football quota. See src/lib/football/index.ts.
  const providerConfigured = Boolean(process.env.API_FOOTBALL_KEY);

  const supabase = createServerSupabaseClient();
  const { data: syncRuns } = await supabase
    .from("sync_runs")
    .select("id, provider, entity_type, status, started_at, finished_at, records_processed, error_message")
    .order("started_at", { ascending: false })
    .limit(10);

  return (
    <div className="flex flex-col gap-8">
      <FadeIn className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">Data health</h1>
        <p className="text-sm text-foreground-muted">Football data provider status and sync jobs.</p>
      </FadeIn>

      <FadeIn delay={0.08} className="kivo-glass-brand flex items-center justify-between gap-4 rounded-2xl p-5">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              providerConfigured ? "bg-live/15" : "bg-white/5"
            }`}
          >
            <Database className={`h-5 w-5 ${providerConfigured ? "text-live" : "text-foreground-subtle"}`} strokeWidth={1.75} />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              {providerConfigured ? "API-Football connected" : "No provider connected"}
            </p>
            <p className="text-xs text-foreground-subtle">
              {providerConfigured
                ? "API_FOOTBALL_KEY is set. Sync writes real fixtures via the service-role client."
                : "Set API_FOOTBALL_KEY to enable syncing. The dev-only mock provider is never used here."}
            </p>
          </div>
        </div>
        {providerConfigured && <FootballSyncButton />}
      </FadeIn>

      <div className="flex flex-col gap-3">
        <FadeIn delay={0.16}>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Recent sync runs</h2>
        </FadeIn>

        {!syncRuns || syncRuns.length === 0 ? (
          <FadeIn delay={0.2} className="kivo-glass rounded-2xl p-6 text-center text-sm text-foreground-muted">
            {providerConfigured
              ? "No syncs have run yet. Use Sync now above to pull today's fixtures."
              : "No syncs have run yet."}
          </FadeIn>
        ) : (
          <div className="flex flex-col gap-2">
            {syncRuns.map((run, index) => {
              const style = STATUS_STYLE[run.status];
              const StatusIcon = style.icon;
              return (
                <FadeIn
                  key={run.id}
                  delay={Math.min(0.2 + index * 0.05, 0.5)}
                  className="kivo-glass flex flex-col gap-2 rounded-xl p-4 transition-colors hover:bg-white/[0.03]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-foreground">
                        <span className="font-medium">{run.provider}</span> · {run.entity_type}
                      </p>
                      <p className="text-xs text-foreground-subtle">
                        Started {formatTimestamp(run.started_at)}
                        {run.finished_at ? ` · finished ${formatTimestamp(run.finished_at)}` : ""}
                        {run.records_processed !== null ? ` · ${run.records_processed} record${run.records_processed === 1 ? "" : "s"}` : ""}
                      </p>
                    </div>
                    <span
                      className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.className}`}
                    >
                      <StatusIcon className={`h-3 w-3 ${run.status === "running" ? "animate-spin" : ""}`} strokeWidth={2} />
                      {style.label}
                    </span>
                  </div>
                  {run.error_message && (
                    <p className="rounded-lg bg-critical/5 px-3 py-2 text-xs text-critical">{run.error_message}</p>
                  )}
                </FadeIn>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
