"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { BarChart3, Plus, Send, PenSquare, X } from "lucide-react";
import { createPost, createPoll } from "@/app/(app)/social/actions";

const MAX_LENGTH = 2000;

// Mirrors poll_options_position_range (0-3) and poll_options_label_length
// (1-80), the same way PostComposer does — client-side UX here, the real
// constraint in migration 0032.
const MIN_POLL_OPTIONS = 2;
const MAX_POLL_OPTIONS = 4;
const MAX_POLL_OPTION_LENGTH = 80;

/**
 * RECOMMENDATIONS.md item 3 (this task): a lighter, faster composer for
 * Match Centre's Room tab, distinct from the general
 * PostComposer (src/components/social/post-composer.tsx). PostComposer is
 * built for authoring a considered take — a multi-row textarea, a Post/Poll
 * mode switch, a full-width "Post" button of its own. A live match room
 * needs the opposite: quick, single-line back-and-forth while the match is
 * actually happening, closer to a chat box (see CommentThread's own compact
 * input for the closest existing analog in this codebase) than a
 * post-authoring flow, so it drops the multi-row textarea for a single-line
 * input with an inline send button.
 *
 * POLLS (KN-29). Poll mode used to be absent here, and hidden in PostComposer
 * whenever fixtureId was set, for one honest reason: Room's post rendering did
 * not carry poll data through, so a poll created in a Room would have had no
 * vote UI ever shown against it. That reason is gone — MatchRoomTab now passes
 * `poll` to PostCard like /social does — and its absence had become the
 * expensive kind of gap. The founding brief names polls by example as
 * "score/MOTM/ref decisions"; every one of those is about one specific match,
 * so a Room that cannot host a poll cannot host the only poll type the brief
 * actually specifies.
 *
 * It is a collapsed panel rather than PostComposer's Post/Poll mode switch,
 * because the point of this composer is that the fast path stays one line: a
 * fan typing "what a hit" during a live match should never have to walk past a
 * poll builder to do it. Building a poll is the deliberate act, so it takes a
 * deliberate tap.
 *
 * Still calls the exact same `createPost` server action PostComposer's own
 * fixtureId branch used — same 2000-char cap, same rate limit
 * (checkRateLimit(`user:<id>`, "create_post", 5, 60) in actions.ts —
 * RECOMMENDATIONS item 5: reused as-is, not reinvented), same moderation
 * enforcement (posts_insert_own's RLS, migration 0045/0047 — item 4). Only
 * the presentational shell changes here; every server-side guarantee
 * PostComposer already had for a Room post stays exactly as it was.
 */
export function RoomComposer({
  fixtureId,
  signedIn,
  onTypingChange,
}: {
  fixtureId: string;
  signedIn: boolean;
  /** KN-62: fires true while there is real text in the box and false once it
   * is empty, sent, or idle for a few seconds. The composer owns this because
   * it is the only thing that knows; MatchRoomTab broadcasts it. */
  onTypingChange?: (typing: boolean) => void;
}) {
  const pathname = usePathname();

  if (!signedIn) {
    return (
      <Link
        href={`/sign-up?redirect_url=${encodeURIComponent(pathname)}`}
        className="kivo-glass flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <span className="flex items-center gap-2 text-xs text-foreground-subtle">
          <PenSquare className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          Sign up to join the chat.
        </span>
        <span className="kivo-gradient-prime shrink-0 rounded-lg px-3 py-1 text-xs font-semibold text-on-accent">Sign up</span>
      </Link>
    );
  }

  return <SignedInRoomComposer fixtureId={fixtureId} onTypingChange={onTypingChange} />;
}

/** How long a stalled composer keeps claiming its author is typing. Long
 * enough to survive a pause for thought, short enough that a tab left open
 * with half a sentence in it does not tell the Room somebody is about to
 * post for the rest of the match. */
const TYPING_IDLE_MS = 6000;

function SignedInRoomComposer({
  fixtureId,
  onTypingChange,
}: {
  fixtureId: string;
  onTypingChange?: (typing: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [pollOpen, setPollOpen] = useState(false);
  const [options, setOptions] = useState(["", ""]);
  const formRef = useRef<HTMLFormElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function reportTyping(typing: boolean) {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    onTypingChange?.(typing);
    if (typing) {
      idleTimer.current = setTimeout(() => onTypingChange?.(false), TYPING_IDLE_MS);
    }
  }

  useEffect(() => {
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, []);

  const filledOptions = options.filter((option) => option.trim().length > 0).length;
  const canSubmitPoll = filledOptions >= MIN_POLL_OPTIONS;

  function closePoll() {
    setPollOpen(false);
    setOptions(["", ""]);
    setError(null);
  }

  return (
    <div className="flex flex-col gap-1">
      <form
        ref={formRef}
        action={(formData) => {
          setError(null);
          startTransition(async () => {
            // Same form, same hidden fixture_id — only which server action
            // reads it changes. createPoll now reads that field too (KN-29),
            // which is what makes the poll land in this Room rather than in the
            // general feed.
            const result = pollOpen ? await createPoll(formData) : await createPost(formData);
            if (result.error) {
              setError(result.error);
            } else {
              formRef.current?.reset();
              setOptions(["", ""]);
              setPollOpen(false);
              reportTyping(false);
            }
          });
        }}
        className="kivo-glass flex flex-col gap-2 rounded-xl p-1.5 pl-3.5 transition-shadow duration-300 focus-within:shadow-[0_0_0_1px_rgba(0,217,255,0.4),0_8px_30px_-8px_rgba(37,99,255,0.35)]"
      >
        <input type="hidden" name="fixture_id" value={fixtureId} />

        <div className="flex items-center gap-2">
          <input
            name="body"
            required
            maxLength={MAX_LENGTH}
            placeholder={pollOpen ? "Ask the room something…" : "Say something about the match…"}
            autoComplete="off"
            onChange={(event) => reportTyping(event.target.value.trim().length > 0)}
            // Enter submits (default single-line <input> in a <form> behaviour)
            // — deliberately no textarea/Shift+Enter handling here, matching
            // the "quick single-line back-and-forth" brief this item asked for.
            className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none"
          />
          <button
            type="button"
            onClick={() => (pollOpen ? closePoll() : setPollOpen(true))}
            aria-pressed={pollOpen}
            aria-label={pollOpen ? "Cancel poll" : "Ask the room a poll"}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
              pollOpen ? "bg-surface-2 text-accent" : "text-foreground-subtle hover:text-foreground-muted"
            }`}
          >
            {pollOpen ? <X className="h-3.5 w-3.5" strokeWidth={2} /> : <BarChart3 className="h-3.5 w-3.5" strokeWidth={2} />}
          </button>
          <motion.button
            type="submit"
            disabled={pending || (pollOpen && !canSubmitPoll)}
            aria-busy={pending}
            aria-label={pending ? "Sending…" : pollOpen ? "Post poll" : "Send"}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.92 }}
            className="kivo-gradient-prime flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-on-accent transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" strokeWidth={2} />
          </motion.button>
        </div>

        <AnimatePresence initial={false}>
          {pollOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="flex flex-col gap-1.5 pb-1.5 pr-1.5">
                {options.map((option, index) => (
                  <div key={index} className="flex items-center gap-1.5">
                    <input
                      name={`option_${index}`}
                      value={option}
                      maxLength={MAX_POLL_OPTION_LENGTH}
                      onChange={(event) =>
                        setOptions((prev) => prev.map((value, i) => (i === index ? event.target.value : value)))
                      }
                      placeholder={`Option ${index + 1}`}
                      autoComplete="off"
                      className="kivo-focusable min-w-0 flex-1 rounded-lg border border-hairline bg-surface-inset px-2.5 py-1.5 text-xs text-foreground placeholder:text-foreground-subtle focus:border-accent focus:outline-none"
                    />
                    {options.length > MIN_POLL_OPTIONS && (
                      <button
                        type="button"
                        onClick={() => setOptions((prev) => prev.filter((_, i) => i !== index))}
                        aria-label={`Remove option ${index + 1}`}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-foreground-subtle transition-colors hover:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                      >
                        <X className="h-3 w-3" strokeWidth={2} />
                      </button>
                    )}
                  </div>
                ))}
                {options.length < MAX_POLL_OPTIONS && (
                  <button
                    type="button"
                    onClick={() => setOptions((prev) => [...prev, ""])}
                    className="flex w-fit items-center gap-1 rounded-lg px-1.5 py-1 text-xs font-medium text-accent transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    <Plus className="h-3 w-3" strokeWidth={2} />
                    Add option
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </form>
      {error && (
        <p className="px-1 text-xs text-critical" role="status" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}
