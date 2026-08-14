"use client";

import { useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
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

export function AiChat({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conversationId = useRef<string | undefined>(undefined);

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
        <h1 className="text-lg font-semibold text-foreground">AI Copilot</h1>
      </motion.div>

      <div className="flex flex-1 flex-col gap-3">
        {messages.length === 0 && (
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
