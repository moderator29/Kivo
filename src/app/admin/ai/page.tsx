import { Sparkles, MessageSquare, Coins, Gauge } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { canViewPlatformHealth } from "@/lib/admin";
import { isAiConfigured } from "@/lib/ai/client";
import { FadeIn } from "@/components/ui/fade-in";
import { AdminPageHeader, AdminSection, AdminAccessNotice } from "@/components/admin/admin-chrome";

/**
 * AI Copilot → is it configured, what is it being asked, and what is it
 * spending?
 *
 * ## Why this page exists
 *
 * RECOMMENDATIONS item 309 audited the founding brief's "platform + provider +
 * AI + social + fantasy health" against Admin and found four of the five real
 * and AI with **zero presence anywhere in `/admin`** — even though
 * `ai_messages.input_tokens` / `output_tokens` are captured per message. The
 * data existed and nothing surfaced it, so an operator had no way to know the
 * Copilot was unhealthy, expensive, or being abused without opening a SQL
 * console.
 *
 * ## Where item 309 was wrong, and what is shown instead
 *
 * It proposed "a count of AI rate-limit rejections from `rate_limit_events`".
 * That count cannot exist. `consume_rate_limit` (migration 0066) refuses to
 * record a refused attempt, on purpose, and says why in the function body:
 * recording refusals would make the sliding window advance on every rejected
 * retry, so a caller hammering the endpoint could hold themselves out
 * indefinitely — a self-inflicted lockout, and a denial-of-service against any
 * key an attacker can name. `rate_limit_events` therefore holds **allowed**
 * requests and only allowed requests. Counting them and calling them rejections
 * would have been an invented signal of exactly the kind this project forbids,
 * so this page counts them as what they are.
 *
 * ## Why the service-role client
 *
 * `ai_conversations` and `ai_messages` carry one policy each, scoped to the
 * conversation's owner, with no admin override (migration 0001). An admin's own
 * client reading them returns that admin's own chats — a number that looks like
 * platform usage and is not. So these counts go through the service-role client
 * and `canViewPlatformHealth` is the whole boundary; see its definition in
 * `src/lib/admin.ts`.
 *
 * **No message content is read on this page, by any query.** Every select is a
 * count or a token column. Knowing what the Copilot costs never required
 * knowing what anybody asked it.
 */

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many token rows one window will pull back before the figure stops being
 *  a total and starts being a floor. A truncated sum is reported as "at least"
 *  rather than quietly under-counted — a number that is silently wrong is worse
 *  than one that admits its bound. */
const TOKEN_ROW_LIMIT = 5000;

type Reading = { value: number; failed: false } | { value: null; failed: true };

function reading(count: number | null, error: unknown): Reading {
  if (error) return { value: null, failed: true };
  return { value: count ?? 0, failed: false };
}

/** A figure, or an honest admission that it could not be read. Never a zero
 *  standing in for a failed query. */
function Figure({ reading: r, label, suffix }: { reading: Reading; label: string; suffix?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={`text-2xl font-semibold ${r.failed ? "text-warning" : "text-foreground"}`}>
        {r.failed ? "—" : `${formatNumber(r.value)}${suffix ?? ""}`}
      </span>
      <span className="text-[11px] leading-snug text-foreground-subtle">
        {r.failed ? `${label} — couldn't be read` : label}
      </span>
    </div>
  );
}

export default async function AdminAiPage() {
  const profile = await getOrCreateProfile();

  // A3. These tables have no admin RLS policy at all, so this check is not a
  // convenience in front of a database rule — it is the rule.
  if (!canViewPlatformHealth(profile?.role)) {
    return (
      <AdminAccessNotice
        title="AI Copilot"
        role={profile?.role}
        subject="AI Copilot usage"
        because="`ai_conversations` and `ai_messages` are owner-scoped with no admin policy (migration 0001), so these figures are counted with the service-role key and this role check is the only boundary in front of them. It is deliberately the narrowest one in Admin."
      />
    );
  }

  const configured = isAiConfigured();
  const supabase = createServiceRoleSupabaseClient();
  const now = new Date().getTime();
  const dayAgo = new Date(now - DAY_MS).toISOString();
  const weekAgo = new Date(now - 7 * DAY_MS).toISOString();

  const [conversations, messagesDay, messagesWeek, assistantWeek, tokenRows, allowedDay] = await Promise.all([
    supabase.from("ai_conversations").select("id", { count: "exact", head: true }),
    supabase.from("ai_messages").select("id", { count: "exact", head: true }).gte("created_at", dayAgo),
    supabase.from("ai_messages").select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
    supabase
      .from("ai_messages")
      .select("id", { count: "exact", head: true })
      .eq("role", "assistant")
      .gte("created_at", weekAgo),
    // The only non-count read on the page, and it selects two integer columns
    // and a timestamp. Content is never fetched.
    supabase
      .from("ai_messages")
      .select("created_at, input_tokens, output_tokens")
      .gte("created_at", weekAgo)
      .not("input_tokens", "is", null)
      .order("created_at", { ascending: false })
      .limit(TOKEN_ROW_LIMIT),
    // Allowed requests, not refused ones — see the header.
    supabase
      .from("rate_limit_events")
      .select("id", { count: "exact", head: true })
      .eq("action", "ai_chat")
      .gte("created_at", dayAgo),
  ]);

  const tokenFailed = Boolean(tokenRows.error);
  const rows = tokenRows.data ?? [];
  const truncated = rows.length >= TOKEN_ROW_LIMIT;
  let inputDay = 0;
  let outputDay = 0;
  let inputWeek = 0;
  let outputWeek = 0;
  for (const row of rows) {
    const input = row.input_tokens ?? 0;
    const output = row.output_tokens ?? 0;
    inputWeek += input;
    outputWeek += output;
    if (row.created_at >= dayAgo) {
      inputDay += input;
      outputDay += output;
    }
  }
  const anyTokensRecorded = rows.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <AdminPageHeader
        icon={Sparkles}
        title="AI Copilot"
        lede="Whether the Copilot can run at all, how much it is being used, and what that use has cost in tokens. Every figure is counted from rows KIVO already stored."
        cost="Opening this page spends no Anthropic tokens and makes no model call. No message content is read by any query on it — only counts and the two token columns."
      />

      <FadeIn
        delay={0.04}
        className="kivo-glass-brand flex flex-col gap-4 rounded-2xl p-5 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              configured ? "bg-live/15" : "bg-surface-2"
            }`}
          >
            <Sparkles
              className={`h-5 w-5 ${configured ? "text-live" : "text-foreground-subtle"}`}
              strokeWidth={1.75}
            />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {configured ? "ANTHROPIC_API_KEY is set" : "AI Copilot is not configured"}
            </p>
            <p className="text-xs leading-relaxed text-foreground-subtle">
              {configured
                ? "isAiConfigured() is true, so /api/ai/chat will attempt a real model call rather than answering 503. This says the key is present; it does not say the key is valid or in credit — only a real call can, and this page never makes one."
                : "isAiConfigured() is false, so /api/ai/chat answers 503 with “AI Copilot isn't configured in this environment yet.” Any usage below predates that, or came from another environment against the same database."}
            </p>
          </div>
        </div>
      </FadeIn>

      <AdminSection
        icon={MessageSquare}
        title="Use"
        note="Counted from `ai_messages` and `ai_conversations` through the service-role client, because both tables are owner-scoped with no admin policy — an admin's own client would count only that admin's own chats."
        delay={0.06}
      >
        <FadeIn delay={0.07} className="kivo-glass grid grid-cols-2 gap-4 rounded-2xl p-5 sm:grid-cols-4">
          <Figure reading={reading(conversations.count, conversations.error)} label="Conversations, all time" />
          <Figure reading={reading(messagesDay.count, messagesDay.error)} label="Messages, last 24 hours" />
          <Figure reading={reading(messagesWeek.count, messagesWeek.error)} label="Messages, last 7 days" />
          <Figure reading={reading(assistantWeek.count, assistantWeek.error)} label="Replies, last 7 days" />
        </FadeIn>
      </AdminSection>

      <AdminSection
        icon={Coins}
        title="Tokens"
        note={
          truncated
            ? `Summed from the ${formatNumber(TOKEN_ROW_LIMIT)} most recent messages carrying a token count, which is as far as one read goes. The week's figures are therefore a floor, not a total, and are labelled as such.`
            : "Summed from `ai_messages.input_tokens` / `output_tokens`, which the chat route records per message. A message with no counts recorded is excluded rather than counted as zero."
        }
        delay={0.09}
      >
        <FadeIn delay={0.1} className="kivo-glass grid grid-cols-2 gap-4 rounded-2xl p-5 sm:grid-cols-4">
          {tokenFailed ? (
            <p className="col-span-full text-xs text-warning">
              The token columns couldn&apos;t be read, so no spend is shown. This is not the same as nothing having
              been spent.
            </p>
          ) : !anyTokensRecorded ? (
            <p className="col-span-full text-xs text-foreground-muted">
              No message in the last 7 days carries a recorded token count. Either the Copilot has not been used in
              that window, or every message predates the columns being written — the rows do not say which, so
              neither does this.
            </p>
          ) : (
            <>
              <Figure
                reading={{ value: inputDay, failed: false }}
                label={truncated ? "Input, last 24 hours (at least)" : "Input, last 24 hours"}
              />
              <Figure
                reading={{ value: outputDay, failed: false }}
                label={truncated ? "Output, last 24 hours (at least)" : "Output, last 24 hours"}
              />
              <Figure
                reading={{ value: inputWeek, failed: false }}
                label={truncated ? "Input, last 7 days (at least)" : "Input, last 7 days"}
              />
              <Figure
                reading={{ value: outputWeek, failed: false }}
                label={truncated ? "Output, last 7 days (at least)" : "Output, last 7 days"}
              />
            </>
          )}
        </FadeIn>
      </AdminSection>

      <AdminSection
        icon={Gauge}
        title="Throttle"
        note="`rate_limit_events` rows for the `ai_chat` action. These are requests the burst limit ALLOWED. Refusals are deliberately not recorded — `consume_rate_limit` (migration 0066) explains why in the function body: recording them would slide the window forward on every rejected retry and let a caller lock themselves, or anybody whose key can be guessed, out indefinitely. So there is no refusal count to show, here or anywhere, and this figure must not be read as one."
        delay={0.12}
      >
        <FadeIn delay={0.13} className="kivo-glass grid grid-cols-1 gap-4 rounded-2xl p-5 sm:grid-cols-2">
          <Figure reading={reading(allowedDay.count, allowedDay.error)} label="Chat requests allowed, last 24 hours" />
        </FadeIn>
      </AdminSection>
    </div>
  );
}
