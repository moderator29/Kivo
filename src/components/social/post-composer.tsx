"use client";

import { useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { PenSquare } from "lucide-react";
import { motion } from "motion/react";
import { createPost } from "@/app/(app)/social/actions";

const MAX_LENGTH = 2000;

export function PostComposer({
  signedIn,
  fixtureId,
  placeholder = "What's your take?",
}: {
  signedIn: boolean;
  /** Scopes the created post to a fixture's Match Room (see match-room.tsx) instead of the general feed. */
  fixtureId?: string;
  placeholder?: string;
}) {
  const pathname = usePathname();

  // A guest gets a non-interactive card, not a live textarea: it used to
  // call e.currentTarget.blur() on focus, which yanked the cursor away with
  // no explanation and trapped keyboard users who tabbed into it (item 101).
  // The whole card is one link instead, so the affordance and the action
  // are the same thing.
  if (!signedIn) {
    return (
      <Link
        href={`/sign-up?redirect_url=${encodeURIComponent(pathname)}`}
        className="kivo-glass flex items-center justify-between gap-3 rounded-2xl p-4 text-left transition-colors duration-150 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
      >
        <span className="flex items-center gap-2.5 text-sm text-foreground-subtle">
          <PenSquare className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          Sign up to share your take.
        </span>
        <span className="kivo-gradient-prime shrink-0 rounded-xl px-4 py-1.5 text-sm font-semibold text-kivo-white">
          Sign up to post
        </span>
      </Link>
    );
  }

  return <SignedInComposer fixtureId={fixtureId} placeholder={placeholder} />;
}

function SignedInComposer({ fixtureId, placeholder }: { fixtureId?: string; placeholder: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
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
      className="kivo-glass flex flex-col gap-3 rounded-2xl p-4 transition-shadow duration-300 focus-within:shadow-[0_0_0_1px_rgba(0,217,255,0.4),0_8px_30px_-8px_rgba(37,99,255,0.35)]"
    >
      {fixtureId && <input type="hidden" name="fixture_id" value={fixtureId} />}
      <textarea
        name="body"
        required
        maxLength={MAX_LENGTH}
        rows={3}
        placeholder={placeholder}
        className="w-full resize-none bg-transparent text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none"
      />
      <div className="flex items-center justify-between">
        {error ? (
          <span className="text-xs text-critical" role="status" aria-live="polite">
            {error}
          </span>
        ) : (
          <span />
        )}
        <motion.button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.96 }}
          className="kivo-gradient-prime rounded-xl px-4 py-1.5 text-sm font-semibold text-kivo-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60 disabled:opacity-50"
        >
          {pending ? "Posting…" : "Post"}
        </motion.button>
      </div>
    </form>
  );
}
