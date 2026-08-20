import Link from "next/link";
import { ScrollText } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readList } from "@/lib/query-result";
import { formatNumber } from "@/lib/format";
import { getOrCreateProfile } from "@/lib/profile";
import { canViewAuditLog } from "@/lib/admin";
import { LoadFailed } from "@/components/ui/load-failed";
import { EmptyState } from "@/components/ui/empty-state";
import { ListSurface, ListRow } from "@/components/ui/list-surface";
import { LocalDateTime } from "@/components/ui/relative-time";
import { FadeIn } from "@/components/ui/fade-in";
import { AdminPageHeader, AdminSection, AdminAccessNotice } from "@/components/admin/admin-chrome";

/**
 * The read side of `audit_log`. There was not one.
 *
 * ## Why this page exists
 *
 * `logAudit` (src/lib/audit.ts) has been writing to `audit_log` from account
 * sanctions, report resolutions, support triage and six football actions, and
 * until now **nothing in KIVO read a single row of it back**. The table was a
 * write-only hole: an operator could not answer "who banned this account, and
 * when" from Admin at all, which is the question an append-only sensitive-action
 * trail exists to answer. RECOMMENDATIONS A8 carried it as open.
 *
 * ## Why it is a list of rows and not a grid of cards
 *
 * `docs/UI_PRIMITIVES.md` §2: `ListSurface`/`ListRow`, one surface with
 * hairline-divided rows. A log is the definitive case for it — the value of a
 * log is reading down a column, and a card per entry is a border, a shadow and
 * a backdrop blur between every line of it.
 *
 * ## Why the action strings are printed verbatim
 *
 * `target_type` is free text by design (migration 0001: "this is the
 * general-purpose sensitive-action log spanning every domain above, an enum
 * here would need editing on every new admin surface") and `action` is too. The
 * obvious nicety — a lookup map turning `resolve_report_dismissed` into
 * "Dismissed a report" — is the wrong call twice over. It goes stale the moment
 * somebody adds an action and then labels it with whatever the fallback says,
 * and a friendly label is a paraphrase of a legal record. Admin may and should
 * use precise technical vocabulary (that rule is the whole reason this section
 * gets to be blunt), so the row prints the string that is actually in the
 * column.
 *
 * ## What this page never does
 *
 * It never writes. `audit_log` has no update or delete policy — deliberately,
 * including for admins — so a correction is a new row, and this page could not
 * edit history even if somebody asked it to.
 */

// The trail must never be a cached snapshot taken before the action being
// investigated. Same reason /admin/support carries it.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/** How far back the filter chips look. The chips can only offer values that
 *  have actually occurred, so they are built from a bounded recent window
 *  rather than from a distinct-on scan of an append-only table that grows
 *  forever. The number is on screen: a chip that is not offered means "not seen
 *  in the last N entries", never "never happened". */
const FACET_WINDOW = 500;

function firstParam(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * `metadata` printed as it is stored, with no key list to go stale.
 *
 * Every writer chooses its own keys, so the honest rendering is the pairs
 * themselves. Objects and arrays are JSON, not "[object Object]".
 */
function metadataPairs(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  return Object.entries(metadata as Record<string, unknown>).map(([key, value]) => {
    const printed =
      value === null || value === undefined
        ? "null"
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    return `${key}=${printed}`;
  });
}

/** A chip that is a filter, at a real 44px target. RECOMMENDATIONS A7: Admin is
 *  used from a phone, and this row of chips is the densest control on the page. */
function FilterChip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`kivo-focusable flex min-h-11 shrink-0 items-center rounded-full border px-3.5 text-xs font-medium transition-colors ${
        active
          ? "border-transparent bg-accent/15 text-accent"
          : "border-hairline text-foreground-muted hover:bg-surface-2 hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    actor?: string | string[];
    target?: string | string[];
    id?: string | string[];
    page?: string | string[];
  }>;
}) {
  const profile = await getOrCreateProfile();

  // A3, without exception: `audit_log_select_admin` is `private.is_admin()`, so
  // a moderator or a football_data_admin reading this table gets zero rows from
  // RLS — and an empty audit log renders as "nobody has done anything", which
  // is the single most misleading sentence this page could produce. The check
  // therefore precedes the query rather than filtering its result.
  if (!canViewAuditLog(profile?.role)) {
    return (
      <AdminAccessNotice
        title="Audit log"
        role={profile?.role}
        subject="The audit log"
        because="`audit_log_select_admin` (migration 0001) is `private.is_admin()`, which recognises only the admin and super-admin roles. This is not an empty trail — it is a trail your role cannot read, and the difference matters more here than anywhere else in Admin."
      />
    );
  }

  const params = await searchParams;
  const actorFilter = firstParam(params.actor);
  const targetTypeFilter = firstParam(params.target);
  const targetIdFilter = firstParam(params.id);
  const page = Math.max(1, Number.parseInt(firstParam(params.page) ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const supabase = createServerSupabaseClient();

  // The user's own client, not the service-role one. `logAudit` writes with the
  // service key because a football_data_admin cannot satisfy the insert policy;
  // reading is different — the role predicate above and the RLS policy are the
  // same two roles, so leaving RLS in the path means a drift between them fails
  // closed rather than open.
  let query = supabase
    .from("audit_log")
    .select(
      "id, created_at, action, target_type, target_id, reason, metadata, actor_profile_id, actor:profiles!audit_log_actor_profile_id_fkey(username, display_name)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (actorFilter) query = query.eq("actor_profile_id", actorFilter);
  if (targetTypeFilter) query = query.eq("target_type", targetTypeFilter);
  if (targetIdFilter) query = query.eq("target_id", targetIdFilter);

  const [entriesResult, facetsResult] = await Promise.all([
    query,
    supabase
      .from("audit_log")
      .select("actor_profile_id, target_type, actor:profiles!audit_log_actor_profile_id_fkey(username)")
      .order("created_at", { ascending: false })
      .limit(FACET_WINDOW),
  ]);

  const entries = readList(entriesResult, "admin.auditLog");
  const total = entriesResult.count ?? null;

  const facets = readList(facetsResult, "admin.auditLogFacets");
  const actorOptions = new Map<string, string>();
  const targetTypes = new Set<string>();
  for (const row of facets.rows) {
    if (row.actor_profile_id) {
      actorOptions.set(row.actor_profile_id, row.actor?.username ?? row.actor_profile_id);
    }
    targetTypes.add(row.target_type);
  }

  const baseParams = new URLSearchParams();
  if (actorFilter) baseParams.set("actor", actorFilter);
  if (targetTypeFilter) baseParams.set("target", targetTypeFilter);
  if (targetIdFilter) baseParams.set("id", targetIdFilter);

  function withParam(key: string, value: string | null, resetPage = true): string {
    const next = new URLSearchParams(baseParams);
    if (value === null) next.delete(key);
    else next.set(key, value);
    if (!resetPage && page > 1) next.set("page", String(page));
    const qs = next.toString();
    return qs ? `/admin/audit?${qs}` : "/admin/audit";
  }

  function pageHref(target: number): string {
    const next = new URLSearchParams(baseParams);
    if (target > 1) next.set("page", String(target));
    const qs = next.toString();
    return qs ? `/admin/audit?${qs}` : "/admin/audit";
  }

  const filtered = Boolean(actorFilter || targetTypeFilter || targetIdFilter);
  const shownTo = from + entries.rows.length;
  const hasOlder = total === null ? entries.rows.length === PAGE_SIZE : shownTo < total;

  return (
    <div className="flex flex-col gap-8">
      <AdminPageHeader
        icon={ScrollText}
        title="Audit log"
        lede="Every sensitive action KIVO records: who did it, what it was done to, and when. Newest first."
        cost="Reading this page spends no provider quota and writes nothing. `audit_log` is append-only by design — it has no update or delete policy, including for admins, so a correction here is a new row rather than an edit."
      />

      <AdminSection
        title="Filters"
        note={`Actors and target types are the ones that appear in the newest ${formatNumber(FACET_WINDOW)} entries. A value not offered here means it has not occurred inside that window — not that it never happened.`}
        delay={0.04}
      >
        <FadeIn delay={0.05} className="flex flex-col gap-3">
          {facets.failed ? (
            // The filters could not be built. Said out loud rather than drawn as
            // "no actors on record", which would be the same lie in a different
            // hat as an RLS-filtered zero.
            <p className="text-xs text-warning">
              The filter values couldn&apos;t be read, so none are offered. The entries below are unaffected.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                  Actor
                </span>
                <div className="flex flex-wrap gap-2">
                  <FilterChip href={withParam("actor", null)} label="Anyone" active={!actorFilter} />
                  {[...actorOptions].map(([id, username]) => (
                    <FilterChip
                      key={id}
                      href={withParam("actor", id)}
                      label={`@${username}`}
                      active={actorFilter === id}
                    />
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                  Target type
                </span>
                <div className="flex flex-wrap gap-2">
                  <FilterChip href={withParam("target", null)} label="Anything" active={!targetTypeFilter} />
                  {[...targetTypes].sort().map((type) => (
                    <FilterChip
                      key={type}
                      href={withParam("target", type)}
                      label={type}
                      active={targetTypeFilter === type}
                    />
                  ))}
                </div>
              </div>

              {/* Not a chip list: target ids are uuids out of an unbounded set,
                  and A6's rule is that a bounded list which cannot reach an
                  arbitrary member of its set needs a query instead. This one
                  arrives as ?id= — from a link elsewhere in Admin, or pasted —
                  and is shown so it can be cleared. */}
              {targetIdFilter && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                    Target id
                  </span>
                  <code className="rounded-lg bg-surface-2 px-2 py-1 text-[11px] text-foreground-muted">
                    {targetIdFilter}
                  </code>
                  <FilterChip href={withParam("id", null)} label="Clear" active={false} />
                </div>
              )}
            </>
          )}
        </FadeIn>
      </AdminSection>

      <AdminSection
        icon={ScrollText}
        title="Entries"
        note={
          entries.failed
            ? undefined
            : total === null
              ? undefined
              : filtered
                ? `${formatNumber(total)} entr${total === 1 ? "y" : "ies"} match these filters.`
                : `${formatNumber(total)} entr${total === 1 ? "y" : "ies"} on record.`
        }
        delay={0.08}
      >
        {entries.failed ? (
          <LoadFailed
            tone="section"
            title="The audit log"
            description="KIVO couldn't read the audit entries. An empty log here would say nobody has done anything, and right now that cannot be confirmed — try again."
          />
        ) : entries.rows.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            tone="section"
            title={filtered ? "No entry matches these filters" : "No action has been recorded yet"}
            description={
              filtered
                ? "The log was read; nothing in it matches. Clear a filter to widen it."
                : "The log was read and it is genuinely empty. Nothing writes to it except an admin action actually being taken."
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            <ListSurface as="ol">
              {entries.rows.map((entry) => {
                const pairs = metadataPairs(entry.metadata);
                const actorName = entry.actor?.username
                  ? `@${entry.actor.username}`
                  : entry.actor_profile_id
                    ? // The fk is `on delete set null`, so a null actor means the
                      // action was system-initiated; a non-null id with no
                      // profile joined means the row is there but unreadable.
                      "actor unreadable"
                    : "no actor recorded";
                return (
                  <ListRow
                    key={entry.id}
                    title={
                      <span className="font-mono text-[13px]">
                        {entry.action}
                        <span className="text-foreground-subtle"> · {entry.target_type}</span>
                      </span>
                    }
                    subtitle={
                      <span className="flex flex-col gap-0.5 whitespace-normal">
                        <span>
                          {actorName}
                          {entry.target_id && (
                            <>
                              {" · "}
                              <span className="font-mono">{entry.target_id}</span>
                            </>
                          )}
                        </span>
                        {entry.reason && <span className="text-foreground-muted">“{entry.reason}”</span>}
                        {pairs.length > 0 && (
                          <span className="break-words font-mono text-[11px] text-foreground-subtle">
                            {pairs.join(" · ")}
                          </span>
                        )}
                      </span>
                    }
                    trailing={
                      <LocalDateTime iso={entry.created_at} format="full" className="text-[11px] whitespace-nowrap" />
                    }
                    className="items-start"
                  />
                );
              })}
            </ListSurface>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[11px] text-foreground-subtle">
                {total === null
                  ? `Showing ${formatNumber(from + 1)}–${formatNumber(shownTo)}`
                  : `Showing ${formatNumber(from + 1)}–${formatNumber(shownTo)} of ${formatNumber(total)}`}
              </span>
              <div className="flex gap-2">
                {page > 1 && <FilterChip href={pageHref(page - 1)} label="← Newer" active={false} />}
                {hasOlder && <FilterChip href={pageHref(page + 1)} label="Older →" active={false} />}
              </div>
            </div>
          </div>
        )}
      </AdminSection>
    </div>
  );
}
