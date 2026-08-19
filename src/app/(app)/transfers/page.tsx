import type { Metadata } from "next";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { FadeIn } from "@/components/ui/fade-in";
import { PageHeader } from "@/components/layout/page-header";
import { NoDataYet } from "@/components/ui/no-data-yet";
import { LoadFailed } from "@/components/ui/load-failed";
import { readList } from "@/lib/query-result";
import { TransfersFilters } from "@/components/transfers/transfers-filters";
import { TransfersList } from "@/components/transfers/transfers-list";
import { getNavItem } from "@/lib/navigation";
import { TRANSFER_TYPE_LABEL } from "@/lib/football/transfer-labels";
import { TRANSFER_STATUS_EXPLAINER } from "@/lib/football/transfer-status";
import { nextTransferWindow, summariseRecordedActivity } from "@/lib/football/transfer-window";
import { TransferWindowPanel } from "@/components/transfers/transfer-window-panel";
import { TRANSFERS_PAGE_SIZE } from "./constants";
import { TRANSFER_SELECT, TRANSFER_TYPES, parseTransferFilters, type TransferListItem } from "./shared";

const item = getNavItem("transfers");

export const metadata: Metadata = { title: item.label };

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; club?: string; from?: string; to?: string }>;
}) {
  const { type: typeParam, club: clubParam, from: fromParam, to: toParam } = await searchParams;
  const supabase = createServerSupabaseClient();

  // Never trust the search params directly in a `.or()`/`.eq()` filter string
  // without validating shape first — an allow-listed enum value, a real UUID,
  // a real date, or the filter is simply skipped. Shared with
  // `loadMoreTransfers` so a "Load more" click can never disagree with the
  // page's own initial query about what counts as a valid filter.
  const filters = { type: typeParam, club: clubParam, from: fromParam, to: toParam };
  const { type: validType, clubId: validClub, from: validFrom, to: validTo } = parseTransferFilters(filters);
  const hasActiveFilters = Boolean(validType || validClub || validFrom || validTo);

  let request = supabase.from("transfers").select(TRANSFER_SELECT).order("transfer_date", { ascending: false });

  // Every filter applied server-side, before `.range()` — the exact bug
  // already found and fixed once in searchFantasyPlayers (filtering in JS
  // after the limit only ever searches whichever rows happened to land in
  // the first page).
  if (validType) request = request.eq("transfer_type", validType);
  if (validClub) request = request.or(`from_team_id.eq.${validClub},to_team_id.eq.${validClub}`);
  if (validFrom) request = request.gte("transfer_date", validFrom);
  if (validTo) request = request.lte("transfer_date", validTo);

  // Requests `PAGE_SIZE + 1` rows so `hasMore` can be read directly off the
  // response, same pattern as `/teams` and `/leagues` (audit item 2: this
  // used to hard-cap at 50 rows with no "Load more" and no truncation note).
  // The window panel's numbers are counts of real rows, never a projection:
  // every transfer dated within the last 30 days, unfiltered by whatever the
  // user is currently filtering the list to — "how busy has it been" is a
  // question about the whole feed, not about their current view.
  // `new Date()` rather than `Date.now()`: the lint rule that governs purity
  // in a render treats the latter as an impure call, and every other server
  // page in the app reads the clock the same way (see /predictions, /leagues).
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);

  const [transfersResult, clubsResult, recentResult, latestResult] = await Promise.all([
    request.range(0, TRANSFERS_PAGE_SIZE),
    supabase.from("teams").select("id, name, short_name").order("name", { ascending: true }),
    supabase
      .from("transfers")
      .select("transfer_date, from_team_id, to_team_id")
      .gte("transfer_date", thirtyDaysAgo),
    supabase
      .from("transfers")
      .select("transfer_date, from_team_id, to_team_id")
      .order("transfer_date", { ascending: false })
      .limit(1),
  ]);

  // Only the feed itself gates the page. The other three reads feed the club
  // filter and the window panel's activity summary, and losing one of those is
  // not a reason to withhold a working transfer feed — each still reports its
  // own failure through readList's log, and summariseRecordedActivity already
  // says "no moves recorded" rather than inventing one.
  const transfersOutcome = readList(transfersResult, "transfers.feed");
  if (transfersOutcome.failed) {
    return <LoadFailed title="Transfers" icon={<item.icon className="h-6 w-6" strokeWidth={1.75} />} />;
  }

  const clubRows = readList(clubsResult, "transfers.clubFilter").rows;
  const recentRows = readList(recentResult, "transfers.recentWindow").rows;
  const latestRow = readList(latestResult, "transfers.latest").rows;

  // `summariseRecordedActivity` derives "most recent" from whatever it is
  // given, so the newest row overall is included alongside the 30-day window —
  // otherwise a feed whose last move is six weeks old would report no most
  // recent move at all, which is a different (and false) statement.
  const activity = summariseRecordedActivity([...recentRows, ...latestRow], now);
  const upcomingWindow = nextTransferWindow(now);

  const allTransfers = transfersOutcome.rows as unknown as TransferListItem[];
  const transfers = allTransfers.slice(0, TRANSFERS_PAGE_SIZE);
  const hasMore = allTransfers.length > TRANSFERS_PAGE_SIZE;

  const clubs = clubRows.map((c) => ({ id: c.id, name: c.name, shortName: c.short_name }));
  const transferTypeOptions = TRANSFER_TYPES.map((value) => ({ value, label: TRANSFER_TYPE_LABEL[value] }));

  // Nothing synced at all yet (no filters applied, still zero rows) keeps the
  // original full-page honest-empty state. A filtered query that happens to
  // match nothing gets an inline empty message instead, further down, so the
  // filters themselves stay on screen to adjust.
  if (!hasActiveFilters && transfers.length === 0) {
    return (
      <NoDataYet icon={<item.icon className="h-6 w-6" strokeWidth={1.75} />} title={item.label} description={item.emptyDescription ?? "Nothing to show here yet."} />
    );
  }

  return (
    <div className="kivo-page">
      {/* Transfers-only keyframe: a very subtle idle left-right nudge on the
          from/to arrow, just enough to read as "in motion" without calling
          attention to itself. Scoped here rather than globals.css since it's
          only used on this page; the sitewide prefers-reduced-motion block in
          globals.css (`* { animation-duration: 0.01ms !important }`) already
          clamps it too, same as kivo-aurora on the landing page. */}
      <style>{`
        @keyframes kivo-transfer-arrow-nudge {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(2px); }
          75% { transform: translateX(-2px); }
        }
      `}</style>

      {/* The one page header, so arriving here from any other screen does not
          shift the content column or change the size of the title. */}
      <PageHeader
        title="Transfer Centre"
        description="Completed moves, newest first. Deals that are done, not rumours."
      />

      {/* The directive asked for Confirmed / Reported / Rumour / Unverified.
          Three of those describe a signal KIVO's data does not carry, so the
          product says so here instead of inventing them — the full reasoning
          lives in src/lib/football/transfer-status.ts and
          RECOMMENDATIONS.md item 178. */}
      <FadeIn delay={0.02} className="rounded-2xl border border-hairline-soft bg-surface-1 p-3 text-xs leading-relaxed text-foreground-subtle">
        {TRANSFER_STATUS_EXPLAINER}
      </FadeIn>

      <FadeIn delay={0.02}>
        <TransferWindowPanel window={upcomingWindow} activity={activity} now={now} />
      </FadeIn>

      <FadeIn delay={0.03}>
        <TransfersFilters
          clubs={clubs}
          transferTypes={transferTypeOptions}
          initialType={validType ?? "All"}
          initialClubId={validClub ?? "All"}
          initialFrom={validFrom ?? ""}
          initialTo={validTo ?? ""}
        />
      </FadeIn>

      {transfers.length === 0 ? (
        <FadeIn delay={0.08} className="kivo-glass flex flex-col items-center gap-2 rounded-2xl px-6 py-16 text-center">
          <p className="text-sm text-foreground-muted">No transfers match those filters.</p>
          <p className="max-w-xs text-xs text-foreground-subtle">Try widening the type, club, or date range above.</p>
        </FadeIn>
      ) : (
        <TransfersList initialTransfers={transfers} initialHasMore={hasMore} filters={filters} />
      )}
    </div>
  );
}
