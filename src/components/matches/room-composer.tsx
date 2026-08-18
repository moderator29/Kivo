"use client";

import { useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { motion } from "motion/react";
import { Send, PenSquare } from "lucide-react";
import { createPost } from "@/app/(app)/social/actions";

const MAX_LENGTH = 2000;

/**
 * RECOMMENDATIONS.md item 3 (this task): a lighter, faster composer for
 * Match Centre's Room tab, distinct from the general
 * PostComposer (src/components/social/post-composer.tsx). PostComposer is
 * built for authoring a considered take — a multi-row textarea, a Post/Poll
 * mode switch, a full-width "Post" button of its own. A live match room
 * needs the opposite: quick, single-line back-and-forth while the match is
 * actually happening, closer to a chat box (see CommentThread's own compact
 * input for the closest existing analog in this codebase) than a
 * post-authoring flow. Poll mode was never reachable here anyway
 * (PostComposer already hid it whenever fixtureId was set, since Room's
 * post rendering has no poll UI) — this drops the option entirely rather
 * than a hidden branch, and drops the multi-row textarea for a single-line
 * input with an inline send button.
 *
 * Still calls the exact same `createPost` server action PostComposer's own
 * fixtureId branch used — same 2000-char cap, same rate limit
 * (checkRateLimit(`user:<id>`, "create_post", 5, 60) in actions.ts —
 * RECOMMENDATIONS item 5: reused as-is, not reinvented), same moderation
 * enforcement (posts_insert_own's RLS, migration 0045/0047 — item 4). Only
 * the presentational shell changes here; every server-side guarantee
 * PostComposer already had for a Room post stays exactly as it was.
 */
export function RoomComposer({ fixtureId, signedIn }: { fixtureId: string; signedIn: boolean }) {
  const pathname = usePathname();

  if (!signedIn) {
    return (
      <Link
        href={`/sign-up?redirect_url=${encodeURIComponent(pathname)}`}
        className="kivo-glass flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-left transition-colors duration-150 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
      >
        <span className="flex items-center gap-2 text-xs text-foreground-subtle">
          <PenSquare className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          Sign up to join the chat.
        </span>
        <span className="kivo-gradient-prime shrink-0 rounded-lg px-3 py-1 text-xs font-semibold text-kivo-white">Sign up</span>
      </Link>
    );
  }

  return <SignedInRoomComposer fixtureId={fixtureId} />;
}

function SignedInRoomComposer({ fixtureId }: { fixtureId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="flex flex-col gap-1">
      <form
        ref={formRef}
        action={(formData) => {
          setError(null);
          startTransition(async () => {
            const result = await createPost(formData);
            if (result.error) {
              setError(result.error);
            } else {
              formRef.current?.reset();
            }
          });
        }}
        className="kivo-glass flex items-center gap-2 rounded-xl p-1.5 pl-3.5 transition-shadow duration-300 focus-within:shadow-[0_0_0_1px_rgba(0,217,255,0.4),0_8px_30px_-8px_rgba(37,99,255,0.35)]"
      >
        <input type="hidden" name="fixture_id" value={fixtureId} />
        <input
          name="body"
          required
          maxLength={MAX_LENGTH}
          placeholder="Say something about the match…"
          autoComplete="off"
          // Enter submits (default single-line <input> in a <form> behaviour)
          // — deliberately no textarea/Shift+Enter handling here, matching
          // the "quick single-line back-and-forth" brief this item asked for.
          className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none"
        />
        <motion.button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          aria-label={pending ? "Sending…" : "Send"}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.92 }}
          className="kivo-gradient-prime flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-kivo-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60 disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" strokeWidth={2} />
        </motion.button>
      </form>
      {error && (
        <p className="px-1 text-xs text-critical" role="status" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}
