"use client";

import { useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { PenSquare, BarChart3, Plus, X } from "lucide-react";
import { motion } from "motion/react";
import { createPost, createPoll } from "@/app/(app)/social/actions";

const MAX_LENGTH = 2000;

// Mirrors poll_options_position_range (0-3) and poll_options_label_length
// (1-80) — see 0032's migration comment on createPoll for why these live in
// two places (client UX here, real DB constraint there).
const MIN_POLL_OPTIONS = 2;
const MAX_POLL_OPTIONS = 4;
const MAX_POLL_OPTION_LENGTH = 80;

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
        className="kivo-glass flex items-center justify-between gap-3 rounded-2xl p-4 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <span className="flex items-center gap-2.5 text-sm text-foreground-subtle">
          <PenSquare className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          Sign up to share your take.
        </span>
        <span className="kivo-gradient-prime shrink-0 rounded-xl px-4 py-1.5 text-sm font-semibold text-on-accent">
          Sign up to post
        </span>
      </Link>
    );
  }

  return <SignedInComposer fixtureId={fixtureId} placeholder={placeholder} />;
}

function SignedInComposer({ fixtureId, placeholder }: { fixtureId?: string; placeholder: string }) {
  const [mode, setMode] = useState<"post" | "poll">("post");
  const [options, setOptions] = useState(["", ""]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function resetAll() {
    formRef.current?.reset();
    setOptions(["", ""]);
  }

  function switchMode(next: "post" | "poll") {
    if (next === mode) return;
    setMode(next);
    setError(null);
  }

  return (
    <form
      ref={formRef}
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const result = mode === "poll" ? await createPoll(formData) : await createPost(formData);
          if (result.error) {
            setError(result.error);
          } else {
            resetAll();
          }
        });
      }}
      className="kivo-glass flex flex-col gap-3 rounded-2xl p-4 transition-shadow duration-300 focus-within:shadow-[0_0_0_1px_var(--accent-hairline),0_8px_30px_-8px_var(--accent-hairline)]"
    >
      {fixtureId && <input type="hidden" name="fixture_id" value={fixtureId} />}

      {/* RECOMMENDATIONS item 172: "a post type ... wire into the post
          composer (a 'create a poll' mode)". Two plain toggle buttons, not a
          full tablist — this switches what one form submits, not between two
          independently navigable views. Hidden inside a fixture's Match Room
          (fixtureId set): MatchRoomTab's post rendering doesn't carry poll
          data through, so offering poll mode there would create a poll with
          no vote UI ever shown against it — general feed only, for now. */}
      {!fixtureId && (
        <div role="group" aria-label="Post type" className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => switchMode("post")}
            aria-pressed={mode === "post"}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
              mode === "post" ? "bg-surface-2 text-foreground" : "text-foreground-subtle hover:text-foreground-muted"
            }`}
          >
            Post
          </button>
          <button
            type="button"
            onClick={() => switchMode("poll")}
            aria-pressed={mode === "poll"}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
              mode === "poll" ? "bg-surface-2 text-foreground" : "text-foreground-subtle hover:text-foreground-muted"
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" strokeWidth={2} />
            Poll
          </button>
        </div>
      )}

      <textarea
        name="body"
        required
        maxLength={MAX_LENGTH}
        rows={mode === "poll" ? 2 : 3}
        placeholder={mode === "poll" ? "Ask something…" : placeholder}
        className="w-full resize-none bg-transparent text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none"
      />

      {mode === "poll" && (
        <div className="flex flex-col gap-2">
          {options.map((option, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                name={`option_${index}`}
                required
                maxLength={MAX_POLL_OPTION_LENGTH}
                value={option}
                onChange={(e) => {
                  const next = [...options];
                  next[index] = e.target.value;
                  setOptions(next);
                }}
                placeholder={`Option ${index + 1}`}
                className="min-w-0 flex-1 rounded-lg border border-hairline bg-transparent px-3 py-1.5 text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              />
              {options.length > MIN_POLL_OPTIONS && (
                <button
                  type="button"
                  onClick={() => setOptions(options.filter((_, i) => i !== index))}
                  aria-label={`Remove option ${index + 1}`}
                  className="shrink-0 rounded-lg p-1.5 text-foreground-subtle transition-colors hover:text-critical focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              )}
            </div>
          ))}
          {options.length < MAX_POLL_OPTIONS && (
            <button
              type="button"
              onClick={() => setOptions([...options, ""])}
              className="flex w-fit items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-accent transition-colors hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              Add option
            </button>
          )}
        </div>
      )}

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
          className="kivo-gradient-prime rounded-xl px-4 py-1.5 text-sm font-semibold text-on-accent kivo-raise focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
        >
          {pending ? "Posting…" : mode === "poll" ? "Post poll" : "Post"}
        </motion.button>
      </div>
    </form>
  );
}
