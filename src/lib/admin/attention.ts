import "server-only";
import type { Database } from "@/lib/supabase/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canHandleSupport, canManageFootballData, canViewModerationData } from "@/lib/admin";
import { getActiveProviderStatus } from "@/lib/football";
import { getDataQualityReport } from "@/lib/admin/data-quality";

type UserRole = Database["public"]["Enums"]["user_role"];

/**
 * The Admin overview's one job: what needs a decision right now.
 *
 * ## Why this replaced four stat cards
 *
 * The overview used to show total users, total posts, pending reports, and a
 * green "Live" pill for the provider — then a paragraph of hand-written prose
 * asserting which features were live. Three problems, in increasing order of
 * seriousness. The counts were true but not actionable (nobody opens Admin to
 * learn how many posts exist). The provider pill said "Live" whenever an API key
 * was present, which was true on the day every season-scoped sync was being
 * refused. And the paragraph was a claim about the system typed by hand, which
 * is the one thing this platform's rules forbid: an operator making decisions on
 * invented numbers is worse than one with none.
 *
 * Every item below is derived from a row that exists, or is not emitted.
 *
 * ## Two rules this file follows without exception
 *
 * **A check the viewer cannot read is not run.** `reports` and `profiles` are
 * RLS-gated; querying them as a role without visibility returns zero rows, which
 * renders as "queue clear" rather than "you cannot see this queue". So each check
 * is gated on the same predicate its page is, and a role that lacks it gets no
 * item at all rather than a reassuring one.
 *
 * **A check that fails says so.** A read error produces an `unknown` item naming
 * the check, never silence and never a zero. This whole page exists to be the
 * place where "nothing is wrong" and "nothing could be read" are told apart.
 *
 * Nothing here spends football-provider quota. The provider's plan endpoint is
 * deliberately not called — that costs a request, and it lives on the Provider
 * page which says so before it is opened.
 */

export type AttentionLevel = "critical" | "warning" | "info" | "clear" | "unknown";

export type AttentionItem = {
  id: string;
  level: AttentionLevel;
  /** The finding, in staff language. */
  title: string;
  /** Why it matters and what it means — one or two sentences, never a slogan. */
  detail: string;
  href?: string;
  hrefLabel?: string;
};

/** Ordering: worst first, and "could not be read" above "all clear", because an
 * unreadable check is a finding and a clear one is not. */
const LEVEL_RANK: Record<AttentionLevel, number> = {
  critical: 0,
  warning: 1,
  unknown: 2,
  info: 3,
  clear: 4,
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** Same threshold, and the same reasoning, as the Pipeline page's staleness
 * badge: the worker is scheduled every minute, so five is a generous margin
 * against ordinary jitter and cold starts. */
const CRON_STALE_MINUTES = 5;

function unknownItem(id: string, subject: string, href?: string, hrefLabel?: string): AttentionItem {
  return {
    id,
    level: "unknown",
    title: `${subject} couldn't be read`,
    detail:
      "This is not the same as there being nothing to report — the check failed, so KIVO has no answer either way. Reload, and if it persists the table or its policy is the place to look.",
    href,
    hrefLabel,
  };
}

async function moderationItems(supabase: ReturnType<typeof createServerSupabaseClient>): Promise<AttentionItem[]> {
  const { count, error } = await supabase
    .from("reports")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "reviewing"]);

  if (error) return [unknownItem("moderation", "The moderation queue", "/admin/moderation", "Moderation")];
  const open = count ?? 0;
  if (open === 0) {
    return [
      {
        id: "moderation",
        level: "clear",
        title: "Moderation queue is clear",
        detail: "No reported post, comment or profile is waiting on a decision.",
        href: "/admin/moderation",
        hrefLabel: "Moderation",
      },
    ];
  }
  return [
    {
      id: "moderation",
      level: "warning",
      title: `${open} report${open === 1 ? "" : "s"} waiting`,
      detail:
        "Reported content stays visible to everyone until somebody acts on it. The queue is ordered oldest first.",
      href: "/admin/moderation",
      hrefLabel: "Moderation",
    },
  ];
}

async function supportItems(supabase: ReturnType<typeof createServerSupabaseClient>): Promise<AttentionItem[]> {
  const { data, error } = await supabase
    .from("support_requests")
    .select("created_at")
    .eq("status", "open")
    .order("created_at", { ascending: true });

  if (error) return [unknownItem("support", "The support queue", "/admin/support", "Support")];
  const open = data ?? [];
  if (open.length === 0) {
    return [
      {
        id: "support",
        level: "clear",
        title: "Nobody is waiting on support",
        detail: "No open request. KIVO has no password and no social login, so this queue is also the lockout queue.",
        href: "/admin/support",
        hrefLabel: "Support",
      },
    ];
  }
  // A day is the line because there is no notification of any kind behind this
  // queue: whoever opens the page is the on-call rota (docs/ACCOUNT_RECOVERY.md).
  const oldestAgeMs = Date.now() - new Date(open[0].created_at).getTime();
  const stale = oldestAgeMs > DAY_MS;
  return [
    {
      id: "support",
      level: stale ? "critical" : "warning",
      title: `${open.length} open support request${open.length === 1 ? "" : "s"}`,
      detail: stale
        ? `The oldest has been waiting ${Math.floor(oldestAgeMs / DAY_MS)} day${Math.floor(oldestAgeMs / DAY_MS) === 1 ? "" : "s"}. Nothing notifies anybody when one lands, and for a user whose sign-in code never arrived this is the only route back into their account.`
        : "Nothing notifies anybody when one lands, and for a user whose sign-in code never arrived this is the only route back into their account.",
      href: "/admin/support",
      hrefLabel: "Support",
    },
  ];
}

async function footballItems(supabase: ReturnType<typeof createServerSupabaseClient>): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];
  const { name: providerName, label: providerLabel } = getActiveProviderStatus();

  if (!providerName) {
    items.push({
      id: "provider",
      level: "critical",
      title: "No football data provider is connected",
      detail:
        "Nothing can sync, so every football surface in the product is empty for that reason rather than because the season hasn't started. Set API_FOOTBALL_KEY, or THE_SPORTS_DB_API_KEY with FOOTBALL_DATA_PROVIDER=thesportsdb.",
      href: "/admin/data-health",
      hrefLabel: "Provider",
    });
    return items;
  }

  const dayAgoIso = new Date(Date.now() - DAY_MS).toISOString();
  const weekAgoIso = new Date(Date.now() - 7 * DAY_MS).toISOString();

  const [anyRuns, failedRuns, latestCron, latestQuota, refusals] = await Promise.all([
    supabase.from("sync_runs").select("id", { count: "exact", head: true }),
    supabase
      .from("sync_runs")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("started_at", dayAgoIso),
    supabase
      .from("sync_runs")
      .select("started_at")
      .eq("trigger_source", "cron")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("sync_runs")
      .select("provider_quota_remaining")
      .not("provider_quota_remaining", "is", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // The provider's own refusals, quoted out of sync_runs rather than
    // re-requested — asking the provider to refuse KIVO again in order to
    // display the refusal would spend quota to learn something already written
    // down. Same matcher as buildPlanCapabilityReport's readRecordedRefusals.
    supabase
      .from("sync_runs")
      .select("entity_type, error_message")
      .not("error_message", "is", null)
      .gte("started_at", weekAgoIso)
      .order("started_at", { ascending: false })
      .limit(100),
  ]);

  if (anyRuns.error) {
    items.push(unknownItem("sync-history", "Sync history", "/admin/data-health/pipeline", "Pipeline"));
    return items;
  }

  if ((anyRuns.count ?? 0) === 0) {
    items.push({
      id: "never-synced",
      level: "critical",
      title: `${providerLabel ?? providerName} is connected but nothing has ever synced`,
      detail:
        "Not one sync run of any kind is on record, so every football table in the database is empty. Provider → Sync now pulls today's fixtures, which is what every other sync depends on.",
      href: "/admin/data-health",
      hrefLabel: "Provider",
    });
    return items;
  }

  const refusedEntityTypes = new Set(
    (refusals.data ?? [])
      .filter((row) =>
        /plan does not cover|does not have access to this season|\(plan\)|upgrade your plan/i.test(
          row.error_message ?? "",
        ),
      )
      .map((row) => row.entity_type),
  );
  if (refusedEntityTypes.size > 0) {
    items.push({
      id: "plan-refusal",
      level: "critical",
      title: `The provider refused ${refusedEntityTypes.size} data type${refusedEntityTypes.size === 1 ? "" : "s"} on plan grounds`,
      detail:
        "A plan refusal arrives as a successful HTTP response with an empty body, so it reaches the product as an empty table rather than an error. Provider shows the season window the provider named and the one setting that changes it.",
      href: "/admin/data-health",
      hrefLabel: "Provider",
    });
  }

  const failedCount = failedRuns.error ? null : (failedRuns.count ?? 0);
  if (failedCount === null) {
    items.push(unknownItem("failed-syncs", "Recent sync failures", "/admin/data-health/pipeline", "Pipeline"));
  } else if (failedCount > 0) {
    items.push({
      id: "failed-syncs",
      level: "warning",
      title: `${failedCount} sync${failedCount === 1 ? "" : "s"} failed in the last 24 hours`,
      detail: "Each failed run keeps the provider's own error message. Pipeline lists them with that message intact.",
      href: "/admin/data-health/pipeline",
      hrefLabel: "Pipeline",
    });
  }

  const quotaRemaining = latestQuota.data?.provider_quota_remaining ?? null;
  if (quotaRemaining !== null && quotaRemaining <= 10) {
    items.push({
      id: "quota",
      level: quotaRemaining === 0 ? "critical" : "warning",
      title:
        quotaRemaining === 0
          ? "Today's provider allowance is used up"
          : `${quotaRemaining} provider request${quotaRemaining === 1 ? "" : "s"} left today`,
      detail:
        "Read from the provider's own x-ratelimit-requests-remaining header on the last run that saw it, not estimated. The allowance resets daily; until then every sync will be refused.",
      href: "/admin/data-health",
      hrefLabel: "Provider",
    });
  }

  const lastCronAt = latestCron.data?.started_at ?? null;
  if (lastCronAt === null) {
    items.push({
      id: "cron",
      level: "info",
      title: "The once-a-minute worker has never fired",
      detail:
        "Live scores are the only thing this layer refreshes, so nothing else is affected. Vercel Cron never fires from local dev — on a real deployment this means the crons entry, CRON_SECRET or FOOTBALL_LIVE_POLLING_ENABLED is still outstanding.",
      href: "/admin/data-health/pipeline",
      hrefLabel: "Pipeline",
    });
  } else {
    const minutesSince = (Date.now() - new Date(lastCronAt).getTime()) / 60_000;
    if (minutesSince > CRON_STALE_MINUTES) {
      items.push({
        id: "cron",
        level: "warning",
        title: "The once-a-minute worker has stopped checking in",
        detail: `Last check-in was ${Math.round(minutesSince)} minutes ago against a one-minute schedule. Live scores are the only thing that goes stale, but it goes stale silently.`,
        href: "/admin/data-health/pipeline",
        hrefLabel: "Pipeline",
      });
    }
  }

  try {
    const quality = await getDataQualityReport();
    const total =
      quality.teamsMissingCrest +
      quality.playersMissingPhoto +
      quality.teamsWithNoSquad +
      quality.orphanedProviderMappings;
    if (total > 0) {
      items.push({
        id: "data-quality",
        level: "info",
        title: `${total} data-quality gap${total === 1 ? "" : "s"} on file`,
        detail:
          "Missing crests and photos, clubs with no squad synced, and provider mappings pointing at rows that no longer exist. None of these break a page; each one makes one look unfinished.",
        href: "/admin/data-health/integrity",
        hrefLabel: "Integrity",
      });
    }
  } catch {
    items.push(unknownItem("data-quality", "The data-quality checks", "/admin/data-health/integrity", "Integrity"));
  }

  if (items.length === 0) {
    items.push({
      id: "football",
      level: "clear",
      title: "Football data has nothing outstanding",
      detail: `${providerLabel ?? providerName} is connected, no sync has failed in the last 24 hours, no plan refusal is on record and the day's allowance is not short.`,
      href: "/admin/data-health",
      hrefLabel: "Provider",
    });
  }

  return items;
}

/**
 * Everything worth a decision, for this role, worst first.
 *
 * `checked` names the areas that were actually examined, so the page can say
 * what a clear list does and does not cover — "all clear" from a role that can
 * only see one of the three areas is a much smaller claim than it looks.
 */
export async function getAdminAttention(
  role: UserRole | undefined | null,
): Promise<{ items: AttentionItem[]; checked: string[] }> {
  const supabase = createServerSupabaseClient();
  const checked: string[] = [];
  const work: Promise<AttentionItem[]>[] = [];

  if (canViewModerationData(role)) {
    checked.push("Moderation");
    work.push(moderationItems(supabase));
  }
  if (canHandleSupport(role)) {
    checked.push("Support");
    work.push(supportItems(supabase));
  }
  if (canManageFootballData(role)) {
    checked.push("Football data");
    work.push(footballItems(supabase));
  }

  const items = (await Promise.all(work)).flat();
  items.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
  return { items, checked };
}
