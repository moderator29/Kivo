import { Database, PlugZap, ListChecks, Gauge } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canManageFootballData } from "@/lib/admin";
import { getActiveProviderStatus } from "@/lib/football";
import { FadeIn } from "@/components/ui/fade-in";
import { FootballSyncButton } from "@/components/admin/football-sync-button";
import { PlanCapabilityPanel } from "@/components/admin/plan-capability-panel";
import { ProviderPlatformPanel } from "@/components/admin/provider-platform-panel";
import { AdminPageHeader, AdminSection } from "@/components/admin/admin-chrome";
import { footballDataGate } from "../access";

/**
 * Football data → Provider. The first question, and only the first question.
 *
 * ADMIN IA PASS 2026-08-19. This route used to be all of Data Health: seventeen
 * panels, 750 lines, in the order they happened to be written. It is now the
 * first of four pages, and it holds exactly the things that answer "can KIVO
 * talk to the provider, and what will that provider serve?" — the connection,
 * the plan, the season window, the day's quota, and the order syncs have to run
 * in. What is on file lives on Coverage; whether the pipeline ran lives on
 * Pipeline; whether what arrived is correct lives on Integrity.
 */

/**
 * RECOMMENDATIONS.md item 61: the sync dependency chain (fixtures unlock
 * everything else) is otherwise only discoverable by reading error strings
 * like "Sync its competition's fixtures first" (sync-squads.ts) or "Sync its
 * fixtures first" (sync-match-details.ts's syncStandings) after a sync
 * already failed. Documented here as an ordered checklist instead, matching
 * exactly what each sync function actually requires — see the "Requires"
 * column's cross-reference to the real guard in each src/lib/football/*.ts
 * file.
 */
const SYNC_ORDER_STEPS: { title: string; where: string; requires: string }[] = [
  {
    title: "1. Sync today's fixtures",
    where: '"Sync now" above',
    requires:
      "Nothing — this is the entry point. Creates KIVO's competitions, teams, venues and fixtures, each mapped to their provider id.",
  },
  {
    title: "2. Sync a team's squad",
    where: "Coverage → club catalogue",
    requires:
      "Step 1 first, for a fixture involving that team — a team with no provider mapping yet can't be squad-synced (sync-squads.ts).",
  },
  {
    title: "3. Sync a season's standings",
    where: "Coverage → league tables",
    requires:
      "Step 1 first, for a fixture in that competition — standings need the competition's provider mapping (sync-match-details.ts).",
  },
  {
    title: "4. Sync a player's transfer history",
    where: "Coverage → transfers",
    requires:
      "Step 2 first, for that player's team — a player only gets a provider mapping via a squad sync (sync-transfers.ts).",
  },
  {
    title: "5. Sync a fixture's lineups, events, and stats",
    // This said "that fixture's Match Centre" until 2026-08-20, and by then it
    // was false: the control had been removed from the public match page a day
    // earlier and no Admin replacement had been built, leaving
    // triggerFixtureDetailsSync with no caller anywhere. A checklist that names
    // a control which does not exist is worse than no checklist.
    where: "Coverage → match detail",
    requires:
      "Step 1 first, for that fixture. A side with no squad synced yet has its lineup entries skipped, not auto-synced, unless squad auto-sync is opted into on the panel's own checkbox (RECOMMENDATIONS.md item 59) — that's an extra provider call per unseen team, so it's off by default.",
  },
];

export default async function ProviderHealthPage() {
  // The layout above renders the lock screen; this returns nothing rather than
  // a second copy of it. What matters is that it returns BEFORE the reads
  // below — a layout does not stop a page from running (see ../access.tsx).
  const { profile, denied } = await footballDataGate("Provider");
  if (denied) return null;

  // Honest per this platform's zero-fake-data rule: the mock provider never counts as
  // "connected" here, even in dev — it exists only so UI can be built without spending
  // real provider quota. getActiveProviderStatus() mirrors getFootballDataProvider()'s
  // own selection order (src/lib/football/index.ts) so this banner never claims a
  // provider is connected that the app wouldn't actually construct — e.g.
  // FOOTBALL_DATA_PROVIDER=thesportsdb with only API_FOOTBALL_KEY set correctly still
  // reads as API-Football here, since that's genuinely what getFootballDataProvider()
  // would fall back to. Also reused by the Admin Overview so the two pages can never
  // disagree about whether a provider is connected.
  const { name: activeProviderName, label: activeProviderLabelOrNull } = getActiveProviderStatus();
  const providerConfigured = activeProviderName !== null;
  const activeProviderLabel = activeProviderLabelOrNull ?? "API-Football";

  const supabase = createServerSupabaseClient();

  // RECOMMENDATIONS.md item 53: the provider's own x-ratelimit-requests-remaining
  // header, persisted on whichever sync_runs row last saw a response — real data,
  // not an estimate. A run that failed before any provider call leaves the column
  // null, so the most recent run and the most recent *reading* are different rows.
  const { data: latestQuotaRun } = await supabase
    .from("sync_runs")
    .select("provider_quota_remaining, started_at")
    .not("provider_quota_remaining", "is", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Today's quota trend. API-Football's quota resets daily and only counts down
  // as syncs run, so the highest reading seen today is the best available proxy
  // for what today started with and the lowest is the most depleted (most
  // recent) reading — both real values off provider_quota_remaining, never
  // estimated. Matches todayIsoDate()'s UTC-day boundary in
  // src/lib/football/sync.ts. Scoped to today in the query rather than filtered
  // out of every run ever recorded.
  const todayIso = new Date().toISOString().slice(0, 10);
  const { data: todaysQuotaRows } = await supabase
    .from("sync_runs")
    .select("provider_quota_remaining")
    .not("provider_quota_remaining", "is", null)
    .gte("started_at", `${todayIso}T00:00:00Z`);
  const todaysReadings = (todaysQuotaRows ?? [])
    .map((row) => row.provider_quota_remaining)
    .filter((reading): reading is number => reading !== null);
  const quotaUsedToday = todaysReadings.length > 0 ? Math.max(...todaysReadings) - Math.min(...todaysReadings) : null;
  const quotaRemaining = latestQuotaRun?.provider_quota_remaining ?? null;

  return (
    <div className="flex flex-col gap-8">
      <AdminPageHeader
        icon={PlugZap}
        title="Provider"
        lede="Whether KIVO can reach the football data provider, what that provider's plan will serve, and how much of today's allowance is left. When a screen in the product is empty, this is the page that says whether waiting will help."
        cost={
          providerConfigured
            ? "Opening this page spends one provider request — the account-status call behind plan and season coverage. Nothing else here costs anything."
            : undefined
        }
        actions={providerConfigured ? <FootballSyncButton /> : undefined}
      />

      <FadeIn
        delay={0.06}
        className="kivo-glass-brand flex flex-col gap-4 rounded-2xl p-5 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              providerConfigured ? "bg-live/15" : "bg-surface-2"
            }`}
          >
            <Database
              className={`h-5 w-5 ${providerConfigured ? "text-live" : "text-foreground-subtle"}`}
              strokeWidth={1.75}
            />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {providerConfigured ? `${activeProviderLabel} connected` : "No provider connected"}
            </p>
            <p className="text-xs leading-relaxed text-foreground-subtle">
              {providerConfigured
                ? activeProviderName === "thesportsdb"
                  ? "FOOTBALL_DATA_PROVIDER=thesportsdb and THE_SPORTS_DB_API_KEY are set. Some sync actions (lineups, events, stats, manager, transfers) aren't supported by this provider — see docs/PROVIDER_ABSTRACTION.md."
                  : "API_FOOTBALL_KEY is set. Sync writes real fixtures via the service-role client."
                : "Set API_FOOTBALL_KEY (or THE_SPORTS_DB_API_KEY + FOOTBALL_DATA_PROVIDER=thesportsdb) to enable syncing. The dev-only mock provider is never used here."}
            </p>
          </div>
        </div>
      </FadeIn>

      {(quotaRemaining !== null || quotaUsedToday !== null) && (
        <AdminSection
          icon={Gauge}
          title="Today's allowance"
          note="Both figures come from the provider's own x-ratelimit-requests-remaining header, recorded on the sync run that saw it. Neither is an estimate, and neither is re-requested to display it."
          delay={0.08}
        >
          <FadeIn delay={0.09} className="kivo-glass grid grid-cols-2 gap-3 rounded-2xl p-5">
            <div className="flex flex-col gap-1">
              <span
                className={`text-2xl font-semibold ${
                  quotaRemaining !== null && quotaRemaining <= 10 ? "text-warning" : "text-foreground"
                }`}
              >
                {quotaRemaining === null ? "—" : formatNumber(quotaRemaining)}
              </span>
              <span className="text-[11px] text-foreground-subtle">
                {quotaRemaining === null ? "No reading recorded yet" : "Requests left today"}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-2xl font-semibold text-foreground">
                {quotaUsedToday === null ? "—" : formatNumber(quotaUsedToday)}
              </span>
              <span className="text-[11px] text-foreground-subtle">
                {quotaUsedToday === null ? "Nothing spent today yet" : "Spent today"}
              </span>
            </div>
          </FadeIn>
        </AdminSection>
      )}

      {/* Immediately under the connection banner on purpose. The banner says a
          provider is connected, which was true all day on 2026-08-19 while
          every season-scoped sync was being refused and every screen drew the
          refusals as empty tables. "Connected" and "able to serve this season"
          are different facts and this is the panel that separates them. */}
      <PlanCapabilityPanel />

      {/* Which providers are configured, whether they are answering, how fast,
          what is on file and what has failed — all of it measured, all of it
          nullable. The capability is passed explicitly rather than assumed from
          having reached this line, because every table behind it is RLS-on with
          no policies: read by a role that cannot see them, they return zero
          rows, and zero failures reads as good news. */}
      <ProviderPlatformPanel canManageFootballData={canManageFootballData(profile?.role)} />

      <AdminSection
        icon={ListChecks}
        title="Sync order"
        note="Every other sync depends on fixtures having run first. Doing them out of order fails with a “no provider mapping yet” error instead of syncing anything."
        delay={0.12}
      >
        <FadeIn delay={0.13} className="kivo-glass flex flex-col gap-2.5 rounded-2xl p-5">
          <ol className="flex flex-col gap-2.5">
            {SYNC_ORDER_STEPS.map((step) => (
              <li key={step.title} className="flex flex-col gap-1 rounded-xl bg-surface-2 px-3 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                  <span className="text-xs font-semibold text-foreground">{step.title}</span>
                  <span className="shrink-0 text-[11px] text-foreground-subtle">{step.where}</span>
                </div>
                <p className="text-[11px] leading-relaxed text-foreground-subtle">{step.requires}</p>
              </li>
            ))}
          </ol>
        </FadeIn>
      </AdminSection>
    </div>
  );
}
