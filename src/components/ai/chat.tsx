"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, ArrowUp, SquarePen, Copy, Check, RotateCcw, X, ShieldCheck, Calculator, Info, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { BorderBeam } from "@/components/ui/border-beam";
import { ThinkingLine } from "@/components/ui/thinking-orb";
import { LocalDateTime, RelativeTime } from "@/components/ui/relative-time";
import { ConversationHistoryPanel } from "@/components/ai/conversation-history";
import { loadConversationMessages, renameConversation, deleteConversation, type ConversationSummary } from "@/app/(app)/ai/actions";

/** RECOMMENDATIONS.md items 184/185: mirrors `GroundingFocus` in
 * `src/lib/ai/grounding.ts` — kept as a plain local type (not imported) since
 * that module is `server-only` and this is a client component. */
type ChatFocus = { type: "fixture" | "team" | "player"; id: string } | null;

/** RECOMMENDATIONS.md items 188/300: the exact literal tags the system
 * prompt (`/api/ai/chat/route.ts`) instructs the model to prefix its own
 * claims with — kept in sync with that prompt text by convention, not by a
 * shared constant, since one lives in a server-only route and the other in a
 * client component. */
const PROVENANCE_VERIFIED = "[[KIVO-VERIFIED]]";
const PROVENANCE_CALCULATED = "[[KIVO-CALCULATED]]";
const PROVENANCE_LIMITED = "[[KIVO-LIMITED]]";
const PROVENANCE_SPLIT_RE = /(\[\[KIVO-VERIFIED\]\]|\[\[KIVO-CALCULATED\]\]|\[\[KIVO-LIMITED\]\])/g;

/** Turns an assistant reply's inline provenance tags into small visible
 * chips instead of raw bracket text — degrades honestly if the model never
 * emits a tag on a given turn (plain text renders exactly as before, no
 * chips, nothing broken). */
function renderMessageContent(content: string) {
  return content.split(PROVENANCE_SPLIT_RE).map((part, i) => {
    if (part === PROVENANCE_VERIFIED) {
      return (
        <span
          key={i}
          className="mr-1 inline-flex translate-y-[-1px] items-center gap-1 rounded-full bg-accent/15 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-accent"
        >
          <ShieldCheck className="h-2.5 w-2.5" strokeWidth={2} />
          Verified
        </span>
      );
    }
    if (part === PROVENANCE_CALCULATED) {
      return (
        <span
          key={i}
          className="mr-1 inline-flex translate-y-[-1px] items-center gap-1 rounded-full bg-violet-400/15 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-violet-300"
        >
          <Calculator className="h-2.5 w-2.5" strokeWidth={2} />
          KIVO-calculated
        </span>
      );
    }
    if (part === PROVENANCE_LIMITED) {
      return (
        <span
          key={i}
          className="mr-1 inline-flex translate-y-[-1px] items-center gap-1 rounded-full bg-warning/15 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-warning"
        >
          <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2} />
          Limited data
        </span>
      );
    }
    return part;
  });
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** KN-24: the model's own reason for stopping, verbatim (`max_tokens`,
   * `end_turn`, …). `max_tokens` is the one the UI acts on — that reply ended
   * because it ran out of room, not because it was finished, and saying so is
   * the same honesty rule items 188/189 applied to provenance, applied to
   * completeness. Undefined while a reply is still streaming. */
  stopReason?: string | null;
  /** Only set once a message is "final" — a live user send, a completed
   * assistant reply, or one loaded from history. Absent while an assistant
   * reply is still streaming in. */
  createdAt?: string;
}

/** One line of the chat route's newline-delimited JSON stream. Kept in sync
 * with the `StreamEvent` union in src/app/api/ai/chat/route.ts. */
type StreamFrame =
  | { type: "meta"; conversationId: string }
  | { type: "delta"; text: string }
  | { type: "truncated" }
  | { type: "done" }
  | { type: "error"; error: string };

/** RECOMMENDATIONS.md items 183/195: the chips (and the honest placeholder
 * below) reflect what buildGroundingContext actually knows for this user
 * instead of hardcoding a question — like "what's synced today" — the app
 * could just as easily answer without spending a model call, or suggesting
 * "how's my team doing" to someone who hasn't followed one. */
function suggestionsFor(hasFollowedEntities: boolean, hasSyncedFixtures: boolean): string[] {
  return [
    hasFollowedEntities ? "What have I followed on KIVO?" : "How do I follow a team or player?",
    hasSyncedFixtures ? "What matches are on today?" : "What can you actually help me with right now?",
    "Explain what xG means.",
  ];
}

export function AiChat({
  signedIn,
  initialConversations = [],
  hasFollowedEntities = false,
  hasSyncedFixtures = false,
  initialFocus = null,
  focusLabel = null,
  groundingSummary = "",
  lastSyncedAt = null,
  quotaRemaining = null,
}: {
  signedIn: boolean;
  initialConversations?: ConversationSummary[];
  hasFollowedEntities?: boolean;
  hasSyncedFixtures?: boolean;
  /** RECOMMENDATIONS.md items 184/185: resolved server-side from `?ctx=&id=`
   * (see `src/app/(app)/ai/page.tsx`) — resent on every turn of this session
   * (see `streamAssistantReply`) so the deep-linked entity keeps grounding
   * the conversation, not just its first turn. */
  initialFocus?: ChatFocus;
  /** Real, human-readable name for `initialFocus` — e.g. "Arsenal vs
   * Chelsea" — same value `grounding.disclosureLabel` resolved server-side,
   * never invented client-side. */
  focusLabel?: string | null;
  /** RECOMMENDATIONS.md item 189: `grounding.summary` verbatim — the exact
   * text sent to the model on page load, shown in the disclosure panel
   * below unmodified. */
  groundingSummary?: string;
  lastSyncedAt?: string | null;
  quotaRemaining?: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // RECOMMENDATIONS.md items 184/185: a lazy initializer (runs once, on
  // mount, before the first paint) rather than an effect that calls
  // setInput — this is real initial state, not a synchronization concern,
  // so it never needs to re-run or fight a later effect. Never auto-sent
  // (see `send`) — opening the Copilot from a match/team/player page should
  // never spend a model call the user didn't ask for.
  const [input, setInput] = useState(() => (initialFocus && focusLabel ? `Tell me about ${focusLabel}.` : ""));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>(initialConversations);
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>(undefined);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  // RECOMMENDATIONS.md items 184/185: the active deep-linked focus, if any —
  // dismissible (the user can clear it without losing the conversation) and
  // otherwise resent on every turn, see streamAssistantReply below.
  const [focus, setFocus] = useState<ChatFocus>(initialFocus);
  // RECOMMENDATIONS.md item 189: collapsed by default so it never competes
  // with the conversation itself — this is a disclosure the user opts into,
  // not something pushed at them.
  const [showDisclosure, setShowDisclosure] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Item 193: track whether the reader was already near the bottom so a new
  // token/message can auto-scroll without yanking someone back down who
  // deliberately scrolled up to reread earlier history. Updated by the
  // scroll listener below (not by the auto-scroll effect itself), so it
  // reflects the last real user-driven scroll position.
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    function onScroll() {
      const distanceFromBottom = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
      stickToBottomRef.current = distanceFromBottom < 150;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (stickToBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages]);

  // Item 192: auto-grow the textarea with the message instead of scrolling
  // its content horizontally like the old single-line <input> did.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  // Shared by send() and regenerate() below — everything from the fetch to
  // the conversations-list bookkeeping is identical between "send a new
  // message" and "redo the last reply"; only how the request body is built
  // and what gets prepended to `messages` beforehand differs.
  async function streamAssistantReply(
    requestBody: { conversationId?: string; message?: string; regenerate?: boolean; focus?: ChatFocus },
    titleFallback: string,
  ) {
    const isNewConversation = !activeConversationId;
    const assistantMessageId = crypto.randomUUID();
    let assistantText = "";
    let assistantStarted = false;
    let returnedId: string | undefined = activeConversationId;
    let streamError: string | null = null;
    let truncated = false;

    function appendAssistantDelta(delta: string) {
      assistantText += delta;
      if (!assistantStarted) {
        assistantStarted = true;
        setMessages((prev) => [...prev, { id: assistantMessageId, role: "assistant", content: assistantText }]);
      } else {
        setMessages((prev) => prev.map((m) => (m.id === assistantMessageId ? { ...m, content: assistantText } : m)));
      }
    }

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Something went wrong.");
        return;
      }

      // Item 187: read the NDJSON body incrementally instead of awaiting one
      // full JSON response — each "delta" frame renders as soon as it's
      // decoded, rather than the whole reply appearing at once at the end.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // last entry may be a partial line — keep it for the next chunk

        for (const line of lines) {
          if (!line.trim()) continue;
          let frame: StreamFrame;
          try {
            frame = JSON.parse(line);
          } catch {
            continue;
          }
          if (frame.type === "meta") {
            returnedId = frame.conversationId;
            setActiveConversationId(frame.conversationId);
          } else if (frame.type === "delta") {
            appendAssistantDelta(frame.text);
          } else if (frame.type === "truncated") {
            truncated = true;
          } else if (frame.type === "error") {
            streamError = frame.error;
          }
        }
      }

      if (assistantStarted) {
        const finishedAt = new Date().toISOString();
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? { ...m, createdAt: finishedAt, stopReason: truncated ? "max_tokens" : null }
              : m,
          ),
        );
      }

      if (streamError) {
        setError(streamError);
      }

      if (returnedId) {
        // Keep the history list in sync without a refetch: brand-new
        // conversations get prepended (title mirrors the server's derivation
        // — see /api/ai/chat/route.ts), existing ones just move to the top
        // since sending bumps ai_conversations.updated_at server-side.
        const now = new Date().toISOString();
        const finalId = returnedId;
        setConversations((prev) => {
          if (isNewConversation) {
            return [{ id: finalId, title: titleFallback.slice(0, 80), updated_at: now }, ...prev];
          }
          return [
            { ...(prev.find((c) => c.id === finalId) ?? { id: finalId, title: titleFallback.slice(0, 80) }), updated_at: now },
            ...prev.filter((c) => c.id !== finalId),
          ];
        });
      }
    } catch {
      setError("Couldn't reach KIVO's AI Copilot. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    if (!signedIn) {
      router.push(`/sign-up?redirect_url=${encodeURIComponent(pathname)}`);
      return;
    }

    setError(null);
    setInput("");
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setPending(true);

    await streamAssistantReply({ conversationId: activeConversationId, message: trimmed, focus }, trimmed);
  }

  // RECOMMENDATIONS.md item 194: regenerate the last assistant reply without
  // re-asking the question. Drops the stale reply from local state and asks
  // the server to redo it against the same conversation history — the
  // server deletes the corresponding row and reuses the last real user
  // message rather than inserting a duplicate (see route.ts's
  // `isRegenerate` handling).
  async function regenerate() {
    if (pending || !activeConversationId) return;
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== "assistant") return;

    setError(null);
    setMessages((prev) => prev.slice(0, -1));
    setPending(true);

    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
    await streamAssistantReply(
      { conversationId: activeConversationId, regenerate: true, focus },
      lastUserMessage?.content ?? "Conversation",
    );
  }

  async function handleCopy(id: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(id);
      setTimeout(() => setCopiedMessageId((current) => (current === id ? null : current)), 1500);
    } catch {
      // Clipboard access can be denied (permissions, insecure context) —
      // nothing destructive happens either way, so fail silently.
    }
  }

  async function handleSelectConversation(id: string) {
    if (id === activeConversationId || loadingConversation) return;
    setError(null);
    setLoadingConversation(true);
    setMessages([]);
    const result = await loadConversationMessages(id);
    if (result.error !== null) {
      setError(result.error);
    } else {
      setActiveConversationId(id);
      setMessages(
        result.messages.map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          createdAt: m.created_at,
          stopReason: m.stop_reason,
        })),
      );
    }
    setLoadingConversation(false);
  }

  function handleNewConversation() {
    setActiveConversationId(undefined);
    setMessages([]);
    setError(null);
  }

  async function handleRenameConversation(id: string, title: string) {
    const previous = conversations;
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
    const result = await renameConversation(id, title);
    if (result.error) setConversations(previous);
    return result;
  }

  async function handleDeleteConversation(id: string) {
    const previous = conversations;
    setConversations((prev) => prev.filter((c) => c.id !== id));
    const wasActive = id === activeConversationId;
    if (wasActive) {
      setActiveConversationId(undefined);
      setMessages([]);
    }
    const result = await deleteConversation(id);
    if (result.error) {
      setConversations(previous);
      // The active chat view was already cleared optimistically above — a
      // failed delete needs its messages back, not just the sidebar row, so
      // re-fetch rather than leave the user staring at an empty conversation
      // that the sidebar now claims still exists.
      if (wasActive) {
        setActiveConversationId(id);
        const reloaded = await loadConversationMessages(id);
        if (reloaded.error === null) {
          setMessages(
            reloaded.messages.map((m) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              createdAt: m.created_at,
              stopReason: m.stop_reason,
            })),
          );
        }
      }
    }
    return result;
  }

  const suggestions = suggestionsFor(hasFollowedEntities, hasSyncedFixtures);
  // Item 183: while the intro chips already avoid suggesting things KIVO
  // can't answer, the input's own placeholder is the more honest place to
  // say so up front, before the user even asks.
  const inputPlaceholder = hasSyncedFixtures
    ? "Ask KIVO's AI Copilot…"
    : "Ask about football knowledge. Today's fixtures aren't synced yet…";
  // Dots show only until the assistant's reply actually starts streaming —
  // once the last message is the (growing) assistant bubble, that bubble is
  // itself the "it's working" signal.
  const showTypingDots = pending && messages[messages.length - 1]?.role !== "assistant";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-8 lg:px-8">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="flex items-center gap-2"
      >
        <motion.div
          className="kivo-gradient-intelligence flex h-8 w-8 items-center justify-center rounded-xl"
          animate={{ scale: [1, 1.1, 1], opacity: [0.9, 1, 0.9] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        >
          <Sparkles className="h-4 w-4 text-on-accent" strokeWidth={1.75} />
        </motion.div>
        <h1 className="flex-1 text-lg font-semibold text-foreground">AI Copilot</h1>

        {/* RECOMMENDATIONS.md item 189: "what KIVO knows right now" — a real
            disclosure the user opts into, not a badge pushed at them. */}
        <motion.button
          type="button"
          onClick={() => setShowDisclosure((v) => !v)}
          aria-label="What KIVO knows right now"
          aria-expanded={showDisclosure}
          whileTap={{ scale: 0.92 }}
          className={cn(
            "kivo-glass-sharp flex h-10 w-10 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
            showDisclosure ? "text-accent" : "text-foreground-muted hover:text-foreground",
          )}
        >
          <Info className="h-4 w-4" strokeWidth={1.75} />
        </motion.button>

        {signedIn && (
          <div className="flex items-center gap-1.5">
            <motion.button
              type="button"
              onClick={handleNewConversation}
              disabled={messages.length === 0 && !activeConversationId}
              aria-label="New conversation"
              whileTap={{ scale: 0.92 }}
              className="kivo-glass-sharp flex h-10 w-10 items-center justify-center rounded-full text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40"
            >
              <SquarePen className="h-4 w-4" strokeWidth={1.75} />
            </motion.button>
            <ConversationHistoryPanel
              conversations={conversations}
              activeConversationId={activeConversationId}
              onSelect={handleSelectConversation}
              onRename={handleRenameConversation}
              onDelete={handleDeleteConversation}
            />
          </div>
        )}
      </motion.div>

      {/* RECOMMENDATIONS.md item 189: `groundingSummary` is `grounding.summary`
          verbatim — the exact text sent to the model — plus the same
          freshness numbers `/transparency` shows, reused via
          getTransparencyFreshness() rather than recomputed here. */}
      <AnimatePresence initial={false}>
        {showDisclosure && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="kivo-glass flex flex-col gap-2 rounded-2xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">What KIVO knows right now</p>
              <p className="text-xs text-foreground-muted">
                Last provider sync:{" "}
                {lastSyncedAt ? (
                  <RelativeTime iso={lastSyncedAt} className="text-foreground" />
                ) : (
                  <span className="text-foreground">nothing synced yet</span>
                )}
                {" · "}
                Provider quota remaining today:{" "}
                <span className="text-foreground">{quotaRemaining !== null ? quotaRemaining : "not yet reported"}</span>
              </p>
              <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-xl bg-surface-inset p-3 text-[11px] leading-relaxed text-foreground-muted">
                {groundingSummary || "No grounding context available."}
              </pre>
              <p className="text-[11px] text-foreground-subtle">
                This is the exact context KIVO hands the model before every reply — nothing outside it is treated as verified.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* RECOMMENDATIONS.md items 184/185: the active deep-linked focus, if
          any — dismissible so the user can fall back to an unscoped session
          without losing the conversation already in progress. */}
      {focus && focusLabel && (
        <div className="flex items-center gap-1.5 self-start rounded-full border border-accent/30 bg-accent/10 py-1 pl-3 pr-1 text-xs text-accent">
          <Sparkles className="h-3 w-3" strokeWidth={2} />
          Focused on {focusLabel}
          <button
            type="button"
            onClick={() => setFocus(null)}
            aria-label="Clear focus"
            className="flex h-5 w-5 items-center justify-center rounded-full transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-3" role="log" aria-live="polite" aria-relevant="additions">
        {loadingConversation && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="kivo-glass mr-auto flex items-center gap-1 rounded-2xl px-4 py-3"
          >
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-foreground-subtle"
                animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
                transition={{ duration: 1, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
              />
            ))}
          </motion.div>
        )}

        {!loadingConversation && messages.length === 0 && (
          <>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
              className="kivo-glass flex flex-col gap-3 rounded-2xl p-5"
            >
              <p className="text-sm text-foreground-muted">
                Ask me anything about football. I only state facts KIVO has actually verified. If the data isn&apos;t
                synced yet, I&apos;ll say so instead of guessing.
              </p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s, i) => (
                  <motion.button
                    key={s}
                    onClick={() => send(s)}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.14 + i * 0.05, ease: [0.22, 1, 0.36, 1] }}
                    whileHover={{ y: -2, transition: { duration: 0.15 } }}
                    whileTap={{ scale: 0.96 }}
                    className="rounded-full border border-hairline px-3 py-1.5 text-xs text-foreground-muted transition-colors hover:border-accent/40 hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    {s}
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </>
        )}

        {messages.map((m, index) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className={cn("flex flex-col gap-1", m.role === "user" ? "items-end" : "items-start")}
          >
            <div
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                m.role === "user" ? "kivo-gradient-prime text-on-accent" : "kivo-glass text-foreground",
              )}
            >
              {m.role === "assistant" ? renderMessageContent(m.content) : m.content}
            </div>

            {/* KN-24. A reply that hit the token ceiling stops mid-thought and
                otherwise looks exactly like a finished one. Said plainly, next
                to the answer rather than buried in a tooltip, and with the one
                action that actually helps — asking it to continue, which is a
                normal next turn rather than a regenerate (regenerate would
                throw away the part that did arrive). */}
            {m.role === "assistant" && m.stopReason === "max_tokens" && (
              <div className="flex max-w-[85%] flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface-inset px-3 py-2 text-xs text-foreground-muted">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" strokeWidth={2} aria-hidden="true" />
                <span>This answer was cut short — it reached KIVO&apos;s length limit before finishing.</span>
                <button
                  type="button"
                  onClick={() => send("Continue from where you stopped.")}
                  disabled={pending}
                  className="font-medium text-accent transition-colors hover:text-foreground disabled:opacity-50"
                >
                  Ask it to continue
                </button>
              </div>
            )}

            {m.role === "assistant" && m.content && (
              <div className="flex items-center gap-2 px-1 text-foreground-subtle">
                <button
                  type="button"
                  onClick={() => handleCopy(m.id, m.content)}
                  aria-label="Copy message"
                  className="flex h-6 w-6 items-center justify-center rounded-lg transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  {copiedMessageId === m.id ? (
                    <Check className="h-3 w-3" strokeWidth={2} />
                  ) : (
                    <Copy className="h-3 w-3" strokeWidth={2} />
                  )}
                </button>
                {/* Item 194: regenerate only ever applies to the single most
                    recent reply — redoing an older one would leave the
                    conversation's later turns grounded in an answer that no
                    longer exists. */}
                {index === messages.length - 1 && (
                  <button
                    type="button"
                    onClick={() => regenerate()}
                    disabled={pending}
                    aria-label="Regenerate response"
                    title="Regenerate response"
                    className="flex h-6 w-6 items-center justify-center rounded-lg transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    <RotateCcw className="h-3 w-3" strokeWidth={2} />
                  </button>
                )}
                {m.createdAt && <LocalDateTime iso={m.createdAt} format="clock" className="text-[11px]" />}
              </div>
            )}
          </motion.div>
        ))}

        {showTypingDots && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="mr-auto"
          >
            {/* The one place in the app that earns a border beam: the model is
                actively composing and there is nothing else on screen to show
                for it. The beam travels the pill's edge while the orb turns
                inside it, so the wait reads as thinking rather than as a
                stalled request. Both stop moving under reduced motion — the
                ring and the dashes stay, so the state is still visible. */}
            <BorderBeam className="w-fit rounded-full" duration={3.6}>
              <ThinkingLine
                label="Thinking…"
                className="kivo-glass rounded-full px-4 py-2.5 text-xs font-medium text-foreground-muted"
              />
            </BorderBeam>
          </motion.div>
        )}

        {error && (
          <p className="text-sm text-critical" role="status" aria-live="polite">
            {error}
          </p>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="kivo-glass flex items-end gap-2 rounded-2xl p-2 transition-shadow duration-300 focus-within:shadow-[0_0_0_1px_var(--accent-hairline),0_8px_30px_-8px_var(--accent-hairline)]"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder={inputPlaceholder}
          maxLength={2000}
          rows={1}
          className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none"
        />
        <motion.button
          type="submit"
          disabled={pending || !input.trim()}
          aria-busy={pending}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.92 }}
          className="kivo-gradient-prime flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40"
          aria-label="Send"
        >
          <ArrowUp className="h-4 w-4" strokeWidth={1.75} />
        </motion.button>
      </form>
    </div>
  );
}
