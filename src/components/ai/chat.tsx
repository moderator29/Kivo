"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion } from "motion/react";
import { Sparkles, ArrowUp, SquarePen, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatClockTime } from "@/lib/format";
import { ConversationHistoryPanel } from "@/components/ai/conversation-history";
import { loadConversationMessages, renameConversation, deleteConversation, type ConversationSummary } from "@/app/(app)/ai/actions";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
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
}: {
  signedIn: boolean;
  initialConversations?: ConversationSummary[];
  hasFollowedEntities?: boolean;
  hasSyncedFixtures?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>(initialConversations);
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>(undefined);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

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

    const isNewConversation = !activeConversationId;
    const assistantMessageId = crypto.randomUUID();
    let assistantText = "";
    let assistantStarted = false;
    let returnedId: string | undefined = activeConversationId;
    let streamError: string | null = null;

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
        body: JSON.stringify({ conversationId: activeConversationId, message: trimmed }),
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
          } else if (frame.type === "error") {
            streamError = frame.error;
          }
        }
      }

      if (assistantStarted) {
        const finishedAt = new Date().toISOString();
        setMessages((prev) => prev.map((m) => (m.id === assistantMessageId ? { ...m, createdAt: finishedAt } : m)));
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
            return [{ id: finalId, title: trimmed.slice(0, 80), updated_at: now }, ...prev];
          }
          return [
            { ...(prev.find((c) => c.id === finalId) ?? { id: finalId, title: trimmed.slice(0, 80) }), updated_at: now },
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
        result.messages.map((m) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content, createdAt: m.created_at })),
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
            reloaded.messages.map((m) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content, createdAt: m.created_at })),
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
          <Sparkles className="h-4 w-4 text-kivo-white" strokeWidth={1.75} />
        </motion.div>
        <h1 className="flex-1 text-lg font-semibold text-foreground">AI Copilot</h1>

        {signedIn && (
          <div className="flex items-center gap-1.5">
            <motion.button
              type="button"
              onClick={handleNewConversation}
              disabled={messages.length === 0 && !activeConversationId}
              aria-label="New conversation"
              whileTap={{ scale: 0.92 }}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 text-foreground-muted transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60 disabled:opacity-40"
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
                  className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-foreground-muted transition-colors hover:border-kivo-cyan/40 hover:bg-white/[0.06] hover:text-foreground"
                >
                  {s}
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        {messages.map((m) => (
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
                m.role === "user" ? "kivo-gradient-prime text-kivo-white" : "kivo-glass text-foreground",
              )}
            >
              {m.content}
            </div>

            {m.role === "assistant" && m.content && (
              <div className="flex items-center gap-2 px-1 text-foreground-subtle">
                <button
                  type="button"
                  onClick={() => handleCopy(m.id, m.content)}
                  aria-label="Copy message"
                  className="flex h-6 w-6 items-center justify-center rounded-lg transition-colors hover:bg-white/[0.06] hover:text-foreground"
                >
                  {copiedMessageId === m.id ? (
                    <Check className="h-3 w-3" strokeWidth={2} />
                  ) : (
                    <Copy className="h-3 w-3" strokeWidth={1.75} />
                  )}
                </button>
                {m.createdAt && <span className="text-[11px]">{formatClockTime(m.createdAt)}</span>}
              </div>
            )}
          </motion.div>
        ))}

        {showTypingDots && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
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
        className="kivo-glass flex items-end gap-2 rounded-2xl p-2 transition-shadow duration-300 focus-within:shadow-[0_0_0_1px_rgba(0,217,255,0.4),0_8px_30px_-8px_rgba(37,99,255,0.35)]"
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
          className="kivo-gradient-prime flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-kivo-white transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60 disabled:opacity-40"
          aria-label="Send"
        >
          <ArrowUp className="h-4 w-4" strokeWidth={2} />
        </motion.button>
      </form>
    </div>
  );
}
