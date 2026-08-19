import { LifeBuoy, Lock } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readList } from "@/lib/query-result";
import { LoadFailed } from "@/components/ui/load-failed";
import { getOrCreateProfile } from "@/lib/profile";
import { canHandleSupport } from "@/lib/admin";
import { FadeIn } from "@/components/ui/fade-in";
import { staggerDelay } from "@/lib/stagger";
import { SUPPORT_TOPIC_LABELS, type SupportTopic } from "@/app/support/topics";
import { SupportRequestRow } from "@/components/admin/support-request-row";

// Live queue — never a cached snapshot of somebody else's view of it.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * The read side of KN-118's escape hatch. `/support` writes here (service-role,
 * rate-limited, migration 0055); this is where a human actually sees it.
 *
 * Without this page the table would be a write-only hole and the /support form
 * would be the exact thing it exists to replace: a promise of a person, with
 * nobody behind it.
 */
export default async function AdminSupportPage() {
  const profile = await getOrCreateProfile();
  const permitted = canHandleSupport(profile?.role);

  const supabase = createServerSupabaseClient();
  const requestsResult = permitted
    ? await supabase
        .from("support_requests")
        .select("id, created_at, reply_email, topic, message, status, internal_note, handled_at")
        // Open first, then oldest-first within each status: the person who has
        // been waiting longest is the person to answer next.
        .order("status", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(PAGE_SIZE)
    : { data: [], error: null };

  // This queue is the only route back in for a user whose sign-in code never
  // arrived. "No open requests" is a claim that nobody is locked out, and a
  // failed read makes it while people are waiting.
  const requestsOutcome = readList(requestsResult, "admin.supportRequests");
  const rows = requestsOutcome.rows;
  const openCount = rows.filter((row) => row.status === "open").length;

  return (
    <div className="flex flex-col gap-6">
      <FadeIn className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
          <LifeBuoy strokeWidth={1.75} className="h-5 w-5 text-accent" aria-hidden="true" />
          Support
        </h1>
        <p className="text-sm text-foreground-muted">
          Everything sent from <span className="font-medium text-foreground">/support</span>. KIVO has no password and
          no social login, so for anyone whose sign-in code never arrives this queue is the only way back in — see{" "}
          <span className="font-medium text-foreground">docs/ACCOUNT_RECOVERY.md</span> for how to verify and recover
          an account by hand.
        </p>
      </FadeIn>

      {!permitted ? (
        // Same discipline as the moderation page: a role that can reach /admin
        // but not this data must be told so, never shown an empty list that
        // reads as "no one needs help".
        <FadeIn className="flex items-start gap-3 rounded-2xl border border-hairline bg-surface-inset p-5">
          <Lock strokeWidth={1.75} className="mt-0.5 h-4 w-4 shrink-0 text-foreground-subtle" aria-hidden="true" />
          <div className="flex flex-col gap-1 text-sm">
            <p className="font-medium text-foreground">You don&apos;t have access to the support queue</p>
            <p className="text-foreground-muted">
              Support requests carry the email addresses of people who can&apos;t sign in, so they&apos;re limited to
              the support, admin and super-admin roles. This is not an empty queue — it&apos;s a queue you can&apos;t
              see.
            </p>
          </div>
        </FadeIn>
      ) : requestsOutcome.failed ? (
        <LoadFailed
          tone="section"
          title="The support queue"
          description="KIVO couldn't read the support requests. An empty queue here would mean nobody is locked out, and right now that cannot be confirmed — try again."
        />
      ) : rows.length === 0 ? (
        <FadeIn className="rounded-2xl border border-hairline bg-surface-inset p-6 text-sm text-foreground-muted">
          Nobody has asked for help yet. This is a real empty queue, not a missing feed.
        </FadeIn>
      ) : (
        <div className="flex flex-col gap-3">
          <FadeIn className="text-xs uppercase tracking-[0.18em] text-foreground-subtle">
            {openCount} open · {rows.length} shown
          </FadeIn>
          {rows.map((row, index) => (
            <FadeIn key={row.id} delay={staggerDelay(index, 0.04)}>
              <SupportRequestRow
                request={{
                  id: row.id,
                  createdAt: row.created_at,
                  replyEmail: row.reply_email,
                  topicLabel: SUPPORT_TOPIC_LABELS[row.topic as SupportTopic] ?? row.topic,
                  message: row.message,
                  status: row.status,
                  internalNote: row.internal_note,
                  handledAt: row.handled_at,
                }}
              />
            </FadeIn>
          ))}
        </div>
      )}
    </div>
  );
}
