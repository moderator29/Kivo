"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Plus, X, PenSquare } from "lucide-react";
import { KivoAvatar } from "@/components/ui/kivo-avatar";
import { motion } from "motion/react";
import { createPost, createPoll } from "@/app/(app)/social/actions";
import { MatchAttachPicker } from "@/components/social/match-attach-picker";
import type { AttachableMatch } from "@/app/(app)/social/compose/matches";
import { cn } from "@/lib/utils";

const MAX_LENGTH = 2000;

// Mirrors poll_options_position_range (0-3) and poll_options_label_length
// (1-80) — see 0032's migration comment on createPoll for why these live in
// two places (client UX here, real DB constraint there).
const MIN_POLL_OPTIONS = 2;
const MAX_POLL_OPTIONS = 4;
const MAX_POLL_OPTION_LENGTH = 80;

/**
 * The composer, as a page.
 *
 * It used to be a card pinned above the feed: three rows tall, a mode switch,
 * a growing list of poll options and a submit button, all competing with the
 * feed underneath it for the same screen. On a phone the textarea and the
 * options list could not both be visible with the keyboard up.
 *
 * As its own screen it gets the whole viewport, a live character count that
 * has somewhere to live, and — the part that actually matters — the back
 * gesture. The founder asked for this explicitly, and named X as the reference:
 * composing is a place you go, and leaving it is a navigation, not a dismissed
 * overlay.
 */
export function ComposeForm({
  avatarUrl,
  username,
  matches,
  matchesFailed,
  initialMatch = null,
}: {
  avatarUrl: string | null;
  username: string;
  /** Fixtures whose Match Room genuinely accepts posts right now — see
   * fetchAttachableMatches. Empty is a real answer and the picker says so. */
  matches: AttachableMatch[];
  matchesFailed: boolean;
  /** Pre-attached from `?match=<id>`, so "post about this match" from a
   * fixture page opens the composer with the subject already set. */
  initialMatch?: AttachableMatch | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"post" | "poll">("post");
  const [match, setMatch] = useState<AttachableMatch | null>(initialMatch);
  const [body, setBody] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const remaining = MAX_LENGTH - body.length;
  const pollReady = mode === "post" || options.filter((o) => o.trim().length > 0).length >= MIN_POLL_OPTIONS;
  const canSubmit = body.trim().length > 0 && pollReady && !pending;

  return (
    <form
      ref={formRef}
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const result = mode === "poll" ? await createPoll(formData) : await createPost(formData);
          if (result.error) {
            setError(result.error);
            return;
          }
          // Back to where the post now lives, with the server's copy of it —
          // never an optimistic card this page invented. A post about a match
          // belongs in that match's room, and landing there is the difference
          // between "posted" and "you are in the conversation".
          router.push(match ? `/matches/${match.id}?tab=room` : "/social");
          router.refresh();
        });
      }}
      className="flex min-h-0 flex-1 flex-col gap-5"
    >
      <div role="group" aria-label="Post type" className="flex w-fit items-center gap-1 rounded-full border border-hairline bg-surface-1 p-1">
        {(["post", "poll"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setMode(value);
              setError(null);
            }}
            aria-pressed={mode === value}
            className={cn(
              "kivo-focus relative flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-colors",
              mode === value ? "text-foreground" : "text-foreground-subtle hover:text-foreground",
            )}
          >
            {mode === value && (
              <motion.span
                layoutId="compose-mode-pill"
                aria-hidden="true"
                className="absolute inset-0 rounded-full bg-surface-raised shadow-soft"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            {value === "poll" ? (
              <BarChart3 className="relative h-3.5 w-3.5" strokeWidth={2} />
            ) : (
              <PenSquare className="relative h-3.5 w-3.5" strokeWidth={2} />
            )}
            <span className="relative">{value === "poll" ? "Poll" : "Post"}</span>
          </button>
        ))}
      </div>

      {/* The subject before the take. `fixture_id` is the field `createPost`
          and `createPoll` have always read (see actions.ts) — this is simply
          the first UI outside a Match Room that sets it. */}
      {match && <input type="hidden" name="fixture_id" value={match.id} />}
      <MatchAttachPicker
        matches={matches}
        failed={matchesFailed}
        selected={match}
        onSelect={setMatch}
      />

      {/* The writing area takes whatever height is left. A composer whose
          field is three lines tall on a 844px screen is the cramped thing this
          page was built to stop being. */}
      <div className="flex min-h-0 flex-1 gap-3">
        <KivoAvatar src={avatarUrl} alt="" size={40} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs text-foreground-subtle">@{username}</span>
          <textarea
            name="body"
            required
            autoFocus
            maxLength={MAX_LENGTH}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              mode === "poll"
                ? match
                  ? `Ask the ${shortMatchLabel(match)} room…`
                  : "Ask something…"
                : match
                  ? `Your take on ${shortMatchLabel(match)}?`
                  : "What's your take?"
            }
            className={cn(
              "w-full resize-none bg-transparent text-base leading-relaxed text-foreground placeholder:text-foreground-subtle focus:outline-none",
              mode === "poll" ? "min-h-24" : "min-h-40 flex-1",
            )}
          />
        </div>
      </div>

      {mode === "poll" && (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
            Options
          </span>
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
                className="kivo-focus min-h-12 min-w-0 flex-1 rounded-xl border border-hairline bg-surface-1 px-3.5 text-sm text-foreground placeholder:text-foreground-subtle"
              />
              {options.length > MIN_POLL_OPTIONS && (
                <button
                  type="button"
                  onClick={() => setOptions(options.filter((_, i) => i !== index))}
                  aria-label={`Remove option ${index + 1}`}
                  className="kivo-focus shrink-0 rounded-lg p-2 text-foreground-subtle transition-colors hover:text-critical"
                >
                  <X className="h-4 w-4" strokeWidth={1.75} />
                </button>
              )}
            </div>
          ))}
          {options.length < MAX_POLL_OPTIONS && (
            <button
              type="button"
              onClick={() => setOptions([...options, ""])}
              className="kivo-focus flex w-fit items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-accent transition-colors hover:text-accent/80"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              Add option
            </button>
          )}
        </div>
      )}

      {/* Pinned to the bottom of the screen: with the keyboard up on a phone, a
          submit button at the end of a scrolling form is below the fold of the
          fold. `mt-auto` is what makes "bottom" mean the bottom of the screen
          rather than the bottom of the text typed so far. */}
      <div className="sticky bottom-0 -mx-4 mt-auto flex items-center justify-between gap-3 border-t border-hairline-soft bg-background/85 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur-xl lg:mx-0 lg:rounded-2xl lg:border lg:border-hairline lg:px-4">
        {/* Silent until there is something to count. An empty composer
            announcing "2000 left" is a number nobody asked for. */}
        <span
          className={cn(
            "text-xs tabular-nums",
            body.length === 0 ? "invisible" : remaining <= 100 ? "text-foreground-muted" : "text-foreground-subtle",
          )}
          aria-live="polite"
        >
          {remaining} left
        </span>
        <button
          type="submit"
          disabled={!canSubmit}
          aria-busy={pending}
          className="kivo-gradient-prime kivo-raise kivo-focus rounded-xl px-5 py-2.5 text-sm font-semibold text-on-accent transition-transform active:scale-95 disabled:opacity-40"
        >
          {pending ? "Posting…" : mode === "poll" ? "Post poll" : "Post"}
        </button>
      </div>

      {error && (
        <p className="text-sm text-critical" role="status" aria-live="polite">
          {error}
        </p>
      )}
    </form>
  );
}

/** The scoreboard shorthand for a fixture, for the composer's own copy. Falls
 * back to the full club name rather than abbreviating one KIVO was not given. */
function shortMatchLabel(match: AttachableMatch): string {
  return `${match.homeShortName || match.homeName} v ${match.awayShortName || match.awayName}`;
}
