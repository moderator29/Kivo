import { Database, Lock, CheckCircle2, XCircle, Loader2, MinusCircle, Trophy, Activity, ShieldCheck } from "lucide-react";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { FadeIn } from "@/components/ui/fade-in";
import { FootballSyncButton } from "@/components/admin/football-sync-button";
import { ScorePredictionsButton } from "@/components/admin/score-predictions-button";
import { ScoreFantasyGameweekButton } from "@/components/admin/score-fantasy-gameweek-button";
import { CORRECT_PREDICTION_POINTS, CORRECT_PREDICTION_XP } from "@/lib/predictions";
import { SCORING_RULES_SUMMARY } from "@/lib/fantasy-scoring";
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

  // predictions_select_own means an admin's own client can't see other
  // users' rows, so this count (like the scoring pass itself) goes through
  // the service-role client — read-only here, just to show an honest number
  // rather than making the button a mystery click.
  const { data: finishedFixtures } = await supabase
    .from("fixtures")
    .select("id")
    .eq("status", "finished")
    .not("home_score", "is", null)
    .not("away_score", "is", null);
  const finishedFixtureIds = (finishedFixtures ?? []).map((f) => f.id);
  let unscoredPredictions = 0;
  if (finishedFixtureIds.length > 0) {
    const service = createServiceRoleSupabaseClient();
    const { count } = await service
      .from("predictions")
      .select("id", { count: "exact", head: true })
      .in("fixture_id", finishedFixtureIds)
      .is("points_awarded", null);
    unscoredPredictions = count ?? 0;
  }

  // fantasy_gameweeks is public-read, but fantasy_points is owner-only RLS
  // (fantasy_points_select_own) — a plain client can't see whether other
  // teams' gameweeks have been scored, so that check goes through the
  // service-role client, same rationale as unscoredPredictions above.
  const { data: recentGameweeks } = await supabase
    .from("fantasy_gameweeks")
    .select("id, number, deadline_at, is_current, season:seasons(name, competition:competitions(short_name, name))")
    .order("deadline_at", { ascending: false })
    .limit(8);

  const gameweekIds = (recentGameweeks ?? []).map((g) => g.id);
  let scoredGameweekIds = new Set<string>();
  if (gameweekIds.length > 0) {
    const service = createServiceRoleSupabaseClient();
    const { data: pointsRows } = await service.from("fantasy_points").select("gameweek_id").in("gameweek_id", gameweekIds);
    scoredGameweekIds = new Set((pointsRows ?? []).map((p) => p.gameweek_id));
  }

  // Data Health's own list below only ever shows the last 10 runs — this is
  // the only place any run-level aggregate exists, so it goes over every
  // sync_runs row rather than reusing that capped list. Just status and
  // records_processed, cheap enough to not need a dedicated summary table.
  const { data: allRuns } = await supabase.from("sync_runs").select("status, records_processed");
  const totalRuns = allRuns?.length ?? 0;
  const successfulRuns = (allRuns ?? []).filter((r) => r.status === "success").length;
  const successRate = totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 100) : null;
  const totalRecordsProcessed = (allRuns ?? []).reduce((sum, r) => sum + (r.records_processed ?? 0), 0);

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

      <FadeIn delay={0.1} className="kivo-glass-brand flex items-center justify-between gap-4 rounded-2xl p-5">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              unscoredPredictions > 0 ? "bg-warning/15" : "bg-white/5"
            }`}
          >
            <Trophy
              className={`h-5 w-5 ${unscoredPredictions > 0 ? "text-warning" : "text-foreground-subtle"}`}
              strokeWidth={1.75}
            />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              {unscoredPredictions > 0
                ? `${unscoredPredictions} prediction${unscoredPredictions === 1 ? "" : "s"} awaiting scoring`
                : "All predictions are scored"}
            </p>
            <p className="text-xs text-foreground-subtle">
              Scores every prediction against real, finished-fixture results. Correct picks earn {CORRECT_PREDICTION_POINTS} points and {CORRECT_PREDICTION_XP} XP.
            </p>
          </div>
        </div>
        <ScorePredictionsButton />
      </FadeIn>

      <div className="flex flex-col gap-3">
        <FadeIn delay={0.11} className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Fantasy scoring</h2>
          <span className="flex items-center gap-1 text-[11px] text-foreground-subtle">
            <ShieldCheck className="h-3 w-3" strokeWidth={2} />
            {SCORING_RULES_SUMMARY.length} published rules
          </span>
        </FadeIn>

        {!recentGameweeks || recentGameweeks.length === 0 ? (
          <FadeIn delay={0.12} className="kivo-glass rounded-2xl p-6 text-center text-sm text-foreground-muted">
            No fantasy gameweeks exist yet. Generate gameweeks from a season on the Fantasy page first.
          </FadeIn>
        ) : (
          <div className="flex flex-col gap-2">
            {recentGameweeks.map((gw, index) => {
              const seasonLabel = [gw.season?.competition?.short_name ?? gw.season?.competition?.name, gw.season?.name]
                .filter(Boolean)
                .join(" · ");
              const scored = scoredGameweekIds.has(gw.id);
              return (
                <FadeIn
                  key={gw.id}
                  delay={Math.min(0.12 + index * 0.03, 0.3)}
                  className="kivo-glass flex items-center justify-between gap-3 rounded-xl p-4"
                >
                  <div>
                    <p className="text-sm text-foreground">
                      <span className="font-medium">GW{gw.number}</span>
                      {seasonLabel ? ` · ${seasonLabel}` : ""}
                      {gw.is_current && (
                        <span className="ml-2 rounded-full bg-kivo-cyan/15 px-1.5 py-0.5 text-[10px] font-semibold text-kivo-cyan">
                          Current
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-foreground-subtle">
                      Deadline {formatTimestamp(gw.deadline_at)}
                      {" · "}
                      {scored ? "Already scored (re-run to refresh)" : "Not scored yet"}
                    </p>
                  </div>
                  <ScoreFantasyGameweekButton gameweekId={gw.id} />
                </FadeIn>
              );
            })}
          </div>
        )}

        <FadeIn delay={0.15} className="kivo-glass rounded-xl p-4 text-xs text-foreground-subtle">
          <p className="mb-1.5 font-semibold text-foreground-muted">Published scoring rules</p>
          <ul className="flex flex-col gap-1">
            {SCORING_RULES_SUMMARY.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </FadeIn>
      </div>

      {totalRuns > 0 && (
        <FadeIn delay={0.13} className="kivo-glass grid grid-cols-3 gap-3 rounded-2xl p-5">
          <div className="flex flex-col items-center gap-1 text-center">
            <Activity className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
            <span className="text-lg font-semibold text-foreground">{totalRuns}</span>
            <span className="text-[11px] text-foreground-subtle">Total syncs</span>
          </div>
          <div className="flex flex-col items-center gap-1 border-x border-white/5 text-center">
            <span
              className={`text-lg font-semibold ${
                successRate === null ? "text-foreground" : successRate >= 90 ? "text-live" : successRate >= 60 ? "text-warning" : "text-critical"
              }`}
            >
              {successRate}%
            </span>
            <span className="text-[11px] text-foreground-subtle">Success rate</span>
          </div>
          <div className="flex flex-col items-center gap-1 text-center">
            <span className="text-lg font-semibold text-foreground">{totalRecordsProcessed.toLocaleString()}</span>
            <span className="text-[11px] text-foreground-subtle">Records synced</span>
          </div>
        </FadeIn>
      )}

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
