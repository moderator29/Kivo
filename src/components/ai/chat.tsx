"use client";

import { useRef, useState } from "react";
import { motion } from "motion/react";
import { Sparkles, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

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

export function AiChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conversationId = useRef<string | undefined>(undefined);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    setError(null);
    setInput("");
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMessage]);
    setPending(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conversationId.current, message: trimmed }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      conversationId.current = data.conversationId;
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: data.reply }]);
    } catch {
      setError("Couldn't reach KIVO's AI Copilot. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-8 lg:px-8">
      <div className="flex items-center gap-2">
        <div className="kivo-gradient-intelligence flex h-8 w-8 items-center justify-center rounded-xl">
          <Sparkles className="h-4 w-4 text-kivo-white" strokeWidth={1.75} />
        </div>
        <h1 className="text-lg font-semibold text-foreground">AI Copilot</h1>
      </div>

      <div className="flex flex-1 flex-col gap-3">
        {messages.length === 0 && (
          <div className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
            <p className="text-sm text-foreground-muted">
              Ask me anything about football. I only state facts KIVO has actually verified. If the data isn&apos;t
              synced yet, I&apos;ll say so instead of guessing.
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-foreground-muted transition-colors hover:bg-white/[0.06] hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
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
          <div className="kivo-glass mr-auto flex items-center gap-1 rounded-2xl px-4 py-3">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-foreground-subtle"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
              />
            ))}
          </div>
        )}

        {error && <p className="text-sm text-critical">{error}</p>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="kivo-glass flex items-center gap-2 rounded-2xl p-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask KIVO's AI Copilot…"
          maxLength={2000}
          className="flex-1 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="kivo-gradient-prime flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-kivo-white transition-opacity disabled:opacity-40"
          aria-label="Send"
        >
          <ArrowUp className="h-4 w-4" strokeWidth={2} />
        </button>
      </form>
    </div>
  );
}
