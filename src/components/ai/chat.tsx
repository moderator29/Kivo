"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion } from "motion/react";
import { Sparkles, ArrowUp, SquarePen } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConversationHistoryPanel } from "@/components/ai/conversation-history";
import { loadConversationMessages, renameConversation, deleteConversation, type ConversationSummary } from "@/app/(app)/ai/actions";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "What can you actually help me with right now?",
  "Explain what xG means.",
  "What data does KIVO have synced today?",
];

export function AiChat({
  signedIn,
  initialConversations = [],
}: {
  signedIn: boolean;
  initialConversations?: ConversationSummary[];
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

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    if (!signedIn) {
      router.push(`/sign-up?redirect_url=${encodeURIComponent(pathname)}`);
      return;
    }

    setError(null);
    setInput("");
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMessage]);
    setPending(true);

    const isNewConversation = !activeConversationId;

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeConversationId, message: trimmed }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      const returnedId: string = data.conversationId;
      setActiveConversationId(returnedId);
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: data.reply }]);

      // Keep the history list in sync without a refetch: brand-new
      // conversations get prepended (title mirrors the server's derivation —
      // see /api/ai/chat/route.ts), existing ones just move to the top since
      // sending bumps ai_conversations.updated_at server-side.
      const now = new Date().toISOString();
      setConversations((prev) => {
        if (isNewConversation) {
          return [{ id: returnedId, title: trimmed.slice(0, 80), updated_at: now }, ...prev];
        }
        return [
          { ...(prev.find((c) => c.id === returnedId) ?? { id: returnedId, title: trimmed.slice(0, 80) }), updated_at: now },
          ...prev.filter((c) => c.id !== returnedId),
        ];
      });
    } catch {
      setError("Couldn't reach KIVO's AI Copilot. Check your connection and try again.");
    } finally {
      setPending(false);
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
      setMessages(result.messages.map((m) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content })));
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
          setMessages(reloaded.messages.map((m) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content })));
        }
      }
    }
    return result;
  }

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

      <div className="flex flex-1 flex-col gap-3">
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
              {SUGGESTIONS.map((s, i) => (
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
            className={cn(
              "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
              m.role === "user"
                ? "kivo-gradient-prime ml-auto text-kivo-white"
                : "kivo-glass mr-auto text-foreground",
            )}
          >
            {m.content}
          </motion.div>
        ))}

        {pending && (
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

        {error && <p className="text-sm text-critical">{error}</p>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="kivo-glass flex items-center gap-2 rounded-2xl p-2 transition-shadow duration-300 focus-within:shadow-[0_0_0_1px_rgba(0,217,255,0.4),0_8px_30px_-8px_rgba(37,99,255,0.35)]"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask KIVO's AI Copilot…"
          maxLength={2000}
          className="flex-1 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none"
        />
        <motion.button
          type="submit"
          disabled={pending || !input.trim()}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.92 }}
          className="kivo-gradient-prime flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-kivo-white transition-opacity disabled:opacity-40"
          aria-label="Send"
        >
          <ArrowUp className="h-4 w-4" strokeWidth={2} />
        </motion.button>
      </form>
    </div>
  );
}
