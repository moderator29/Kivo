import { AlertTriangle, CheckCircle2, CircleDashed, Zap } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { DISPLAY_LOCALE } from "@/lib/format";
import { getAutomationStatus, type AutomationLayerId } from "@/lib/admin/automation-status";

/**
 * "Is football data actually arriving, and if not, what is the one thing left
 * to do about it?"
 *
 * Built because the same failure has happened twice on this project: something
 * is built, documented and deployed, and then quietly never runs, because the
 * final step was a dashboard action nobody took. Documentation did not catch it
 * either time — the person who needs to know is looking at an empty screen, not
 * at a markdown file. So the empty screen says it.
 *
 * Every status is read from real `sync_runs` rows: has a run with this trigger
 * source ever landed. Deliberately not inferred from whether an env var is set,
 * because a set env var in the wrong project produces a confident green tick
 * for a schedule that does not exist.
 */

type LayerCopy = {
  title: string;
  cadence: string;
  /** What it keeps fresh — stated so nobody reads "automatic" as "live scores". */
  freshness: string;
  /** The exact remaining step, shown only when the layer has never run. */
  activation: string;
};

const LAYER_COPY: Record<AutomationLayerId, LayerCopy> = {
  auto: {
    title: "On-demand freshness",
    cadence: "When someone opens Home, Matches or Live and the data is stale",
    freshness: "Everything, eventually — but the visitor who triggers it sees the old data, and a quiet site refreshes nothing.",
    activation:
      "Needs nothing configured. If this has never run, the most likely reasons are that the deployment predates this feature, or nobody has opened a football page since it shipped.",
  },
  daily: {
    title: "Daily baseline",
    cadence: "Once a day, 05:00 UTC",
    freshness: "Today's fixtures and the clubs, competitions and venues they create, plus five league tables a day. Never a live scoreline.",
    activation:
      'Add a "crons" entry to vercel.json pointing at /api/cron/sync-daily with schedule "0 5 * * *", and make sure CRON_SECRET is set in Vercel. The exact block is in ENVIRONMENT.md. Daily is the only cadence the Hobby plan accepts.',
  },
  cron: {
    title: "Once-a-minute worker",
    cadence: "Every minute",
    freshness: "Live scores. This is the only one that is live scores.",
    activation:
      "Add two Supabase Vault secrets (kivo_app_base_url and kivo_cron_secret, matching CRON_SECRET) and set FOOTBALL_LIVE_POLLING_ENABLED=true in Vercel. The scheduler itself is already running and doing nothing until then.",
  },
};

const LAYER_ORDER: AutomationLayerId[] = ["auto", "daily", "cron"];

function timestamp(value: string): string {
  return new Date(value).toLocaleString(DISPLAY_LOCALE, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export async function AutomationStatusPanel() {
  const status = await getAutomationStatus();

  return (
    <div className="flex flex-col gap-3">
      <FadeIn className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <Zap className="h-3.5 w-3.5" strokeWidth={2} />
          Is data actually arriving?
        </h2>
        <p className="text-xs text-foreground-subtle">
          Read from real sync runs, not from configuration — a set environment variable in the wrong place would
          otherwise show a green tick for a schedule that does not exist.
        </p>
      </FadeIn>

      {status.neverSynced && (
        <FadeIn delay={0.02} className="kivo-glass flex items-start gap-2.5 rounded-2xl border border-warning/25 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={1.75} />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-foreground">No sync has ever run on this database.</p>
            <p className="text-xs text-foreground-muted">
              That is why Matches, Live, Teams and the league tables are empty — not a bug in any of them. Any one of
              the three below fixes it, and &ldquo;Sync now&rdquo; above does it immediately.
            </p>
          </div>
        </FadeIn>
      )}

      <div className="flex flex-col gap-2">
        {LAYER_ORDER.map((id, index) => {
          const layer = status.layers[id];
          const copy = LAYER_COPY[id];
          const hasRun = layer.lastRunAt !== null;

          return (
            <FadeIn key={id} delay={0.04 + index * 0.03} className="kivo-glass flex flex-col gap-2 rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-foreground">{copy.title}</span>
                  <span className="text-xs text-foreground-subtle">{copy.cadence}</span>
                </div>
                <span
                  className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                    hasRun ? "border-live/30 text-live" : "border-hairline text-foreground-subtle"
                  }`}
                >
                  {hasRun ? (
                    <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
                  ) : (
                    <CircleDashed className="h-3 w-3" strokeWidth={2} />
                  )}
                  {hasRun ? "Running" : "Never run"}
                </span>
              </div>

              <p className="text-xs text-foreground-muted">{copy.freshness}</p>

              {hasRun ? (
                <p className="text-[11px] text-foreground-subtle">
                  Last fired {timestamp(layer.lastRunAt!)} · {layer.runsLast24h}{" "}
                  {layer.runsLast24h === 1 ? "run" : "runs"} in the last 24h
                  {layer.lastSuccessAt
                    ? ` · last actually refreshed data ${timestamp(layer.lastSuccessAt)}`
                    : " · has not yet refreshed any data (every run so far decided there was nothing to do)"}
                </p>
              ) : (
                <p className="rounded-lg bg-surface-1 px-3 py-2 text-[11px] text-foreground-muted">
                  <span className="font-semibold text-foreground">To turn this on: </span>
                  {copy.activation}
                </p>
              )}
            </FadeIn>
          );
        })}
      </div>
    </div>
  );
}
