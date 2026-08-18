"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { submitSupportRequest } from "./actions";
import { SUPPORT_TOPICS, type SupportTopic } from "./topics";

/**
 * The form itself. Rendered on a public route on purpose: the person who needs
 * it most is the one who cannot get past the sign-in wall, so nothing here may
 * require a session.
 */
export function SupportForm({ defaultTopic }: { defaultTopic?: SupportTopic }) {
  const [topic, setTopic] = useState<SupportTopic>(defaultTopic ?? "sign_in");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  const selected = SUPPORT_TOPICS.find((entry) => entry.value === topic);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await submitSupportRequest(formData);
      if (result.ok) setSent(true);
      else setError(result.error);
    });
  }

  if (sent) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24 }}
        className="kivo-glass-brand flex w-full max-w-xl flex-col items-center gap-3 rounded-3xl p-8 text-center"
      >
        <CheckCircle2 strokeWidth={1.5} className="h-8 w-8 text-live" aria-hidden="true" />
        <h2 className="text-xl font-semibold tracking-tight text-foreground">That&apos;s with us</h2>
        {/* Honest about the mechanism: KIVO has no transactional email of its
            own yet (ENVIRONMENT.md), so there is no automated confirmation and
            no ticket number to promise. A person reads the queue and replies
            from a real mailbox. Saying that plainly beats a fake "ticket
            #12345 created" that nothing behind the scenes can honour. */}
        <p className="text-sm leading-relaxed text-foreground-muted">
          It&apos;s in KIVO&apos;s support queue, which a person reads. There&apos;s no automatic reply — when we
          answer, it&apos;ll come from a real person, to the address you gave us. KIVO is small right now, so that may
          take a day or two.
        </p>
        <Link
          href="/"
          className="mt-2 text-sm font-medium text-accent transition-colors hover:text-foreground"
        >
          Back to KIVO
        </Link>
      </motion.div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="kivo-glass-brand flex w-full max-w-xl flex-col gap-5 rounded-3xl p-6 sm:p-8">
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-2 text-sm font-medium text-foreground">What&apos;s this about?</legend>
        <div className="flex flex-wrap gap-2">
          {SUPPORT_TOPICS.map((entry) => {
            const active = entry.value === topic;
            return (
              <button
                key={entry.value}
                type="button"
                aria-pressed={active}
                onClick={() => setTopic(entry.value)}
                className={`kivo-focusable rounded-full border px-3.5 py-2 text-xs font-medium transition-colors ${
                  active
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-hairline bg-surface-inset text-foreground-muted hover:text-foreground"
                }`}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
        <input type="hidden" name="topic" value={topic} />
        {selected ? <p className="text-xs text-foreground-subtle">{selected.hint}</p> : null}
      </fieldset>

      <div className="flex flex-col gap-2">
        <label htmlFor="reply_email" className="text-sm font-medium text-foreground">
          Email we can reply to
        </label>
        <input
          id="reply_email"
          name="reply_email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          className="kivo-focusable w-full rounded-2xl border border-hairline bg-surface-inset px-4 py-3 text-base text-foreground transition-colors placeholder:text-foreground-subtle focus:border-accent focus:outline-none"
        />
        {/* The single most useful instruction on this page: the whole reason
            somebody is here is usually that mail to their KIVO address is not
            arriving. */}
        <p className="text-xs text-foreground-subtle">
          If you&apos;re stuck signing in, a different address to the one you signed up with often works better — and
          tell us the original one in your message.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="message" className="text-sm font-medium text-foreground">
          What happened?
        </label>
        <textarea
          id="message"
          name="message"
          required
          minLength={10}
          maxLength={4000}
          rows={6}
          placeholder="The more specific, the faster this gets fixed — what you did, what you expected, what happened instead."
          className="kivo-focusable w-full resize-y rounded-2xl border border-hairline bg-surface-inset px-4 py-3 text-base text-foreground transition-colors placeholder:text-foreground-subtle focus:border-accent focus:outline-none"
        />
      </div>

      <AnimatePresence initial={false}>
        {error ? (
          <motion.p
            role="alert"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="text-sm text-critical"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <motion.button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        whileHover={pending ? undefined : { scale: 1.01 }}
        whileTap={pending ? undefined : { scale: 0.98 }}
        className="kivo-gradient-prime flex w-full items-center justify-center gap-2 rounded-full px-6 py-3.5 text-base font-semibold text-kivo-white shadow-[0_8px_30px_-8px_rgba(37,99,255,0.55)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
      >
        {pending ? <Loader2 strokeWidth={1.75} className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        Send to KIVO
      </motion.button>
    </form>
  );
}
