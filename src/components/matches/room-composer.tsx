"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { BarChart3, Gavel, Plus, Send, PenSquare, Trophy, X } from "lucide-react";
import { createPost, createPoll } from "@/app/(app)/social/actions";
import { createMotmPoll, createRefereePoll } from "@/app/(app)/matches/match-room-poll-actions";
import { REFEREE_DECISION_OPTIONS, type RefereeDecision } from "@/lib/match-room-polls";

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
/**
 * KIVO_NEXT_GEN KN-100. The founding brief names Match Room polls by example —
 * "score/MOTM/ref decisions" — and a sibling change made a Room able to *host*
 * one. This is the part the item actually asks for: the templates, so asking
 * the room the question the brief names is one tap rather than typing a
 * question and three options with a match going on.
 *
 * Two rules the templates hold to.
 *
 * **Options are real or they are blank.** "Who wins?" offers the two clubs'
 * actual names and a draw, because those come from the fixture.
 *
 * The two poll types the brief names explicitly — man of the match, and
 * referee decisions — are no longer templates at all. They are first-class
 * kinds (migration 0078), posted through TemplatedPollActions below, and the
 * MOTM ballot is seeded from the fixture's REAL synced starting XIs. That is
 * not KIVO choosing a shortlist: the players who started are a fact, not an
 * opinion about who is worth voting for. When the lineup has not been synced,
 * the action says so plainly and posts nothing.
 *
 * **A poll is fan opinion and must never read as a KIVO prediction**
 * (RECOMMENDATIONS items 178/246). A "who wins?" poll is fine — it is what the
 * room thinks. A KIVO-computed win probability is not, and nothing here
 * computes, weights or ranks anything: the poll stack counts votes, and the
 * composer says so in one line under the templates.
 */
type PollTemplate = {
  id: string;
  chip: string;
  question: string;
  /** Options with real content; empty strings leave the field for the author. */
  buildOptions: (home: string, away: string) => string[];
  /** When this template makes sense. A finished match has already answered "who wins?". */
  availableWhen: (isFinished: boolean) => boolean;
};

const POLL_TEMPLATES: PollTemplate[] = [
  {
    id: "who-wins",
    chip: "Who wins?",
    question: "Who wins?",
    buildOptions: (home, away) => [home, "Draw", away],
    availableWhen: (isFinished) => !isFinished,
  },
  // "Man of the match" and "Referee decision" used to live here as freeform
  // templates that pre-filled this same text box. They have moved out, to
  // TemplatedPollActions below, because the brief names them as poll *types*
  // and a pre-filled text box is not a type: five seconds after posting, KIVO
  // cannot tell such a poll apart from any other, so nothing downstream can
  // read it. They are now real `posts.poll_kind` rows (migration 0078) —
  // which is also what lets a man-of-the-match *prediction* be settled
  // against the room's answer instead of being permanently unresolvable.
];

export function RoomComposer({
  fixtureId,
  signedIn,
  onTypingChange,
  homeTeamName,
  awayTeamName,
  isFinished = false,
}: {
  fixtureId: string;
  signedIn: boolean;
  /** KN-62: fires true while there is real text in the box and false once it
   * is empty, sent, or idle for a few seconds. The composer owns this because
   * it is the only thing that knows; MatchRoomTab broadcasts it. */
  onTypingChange?: (typing: boolean) => void;
  /** KN-100: real club names for the "Who wins?" template's options. */
  homeTeamName: string;
  awayTeamName: string;
  isFinished?: boolean;
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

  return (
    <SignedInRoomComposer
      fixtureId={fixtureId}
      onTypingChange={onTypingChange}
      homeTeamName={homeTeamName}
      awayTeamName={awayTeamName}
      isFinished={isFinished}
    />
  );
}

/** How long a stalled composer keeps claiming its author is typing. Long
 * enough to survive a pause for thought, short enough that a tab left open
 * with half a sentence in it does not tell the Room somebody is about to
 * post for the rest of the match. */
const TYPING_IDLE_MS = 6000;

function SignedInRoomComposer({
  fixtureId,
  onTypingChange,
  homeTeamName,
  awayTeamName,
  isFinished,
}: {
  fixtureId: string;
  onTypingChange?: (typing: boolean) => void;
  homeTeamName: string;
  awayTeamName: string;
  isFinished: boolean;
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

  /**
   * Fills the composer from a template. The question goes into the existing
   * body input (which `createPoll` already reads as the question), and the
   * options replace whatever was there — a template is a starting point, and
   * the author can edit every field afterwards, including the club names.
   */
  function applyTemplate(template: PollTemplate) {
    const filled = template.buildOptions(homeTeamName, awayTeamName);
    setOptions(filled.length >= MIN_POLL_OPTIONS ? filled : ["", ""]);
    setPollOpen(true);
    setError(null);
    const bodyInput = formRef.current?.elements.namedItem("body");
    if (bodyInput instanceof HTMLInputElement || bodyInput instanceof HTMLTextAreaElement) {
      bodyInput.value = template.question;
      bodyInput.focus();
    }
  }

  const templates = POLL_TEMPLATES.filter((template) => template.availableWhen(isFinished));

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
                {/* KN-100: one tap for the three questions the founding brief
                    names by example. Everything they fill in is editable. */}
                <TemplatedPollActions fixtureId={fixtureId} disabled={pending} />

                {templates.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {templates.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        disabled={pending}
                        onClick={() => applyTemplate(template)}
                        className="kivo-glass-sharp rounded-lg px-2.5 py-1 text-[11px] font-medium text-foreground-muted transition-colors hover:text-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                      >
                        {template.chip}
                      </button>
                    ))}
                  </div>
                )}
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
                <p className="text-[10px] text-foreground-subtle">
                  A Room poll is what this room thinks. KIVO counts the votes and nothing else — it never predicts a
                  result.
                </p>
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


/**
 * The two poll types the founding brief names, as one tap each.
 *
 * Separated from the freeform builder above by a hairline, because they are a
 * different kind of act: the builder asks the author to write a question, and
 * these two ask a question KIVO already knows how to ask — and, crucially,
 * knows how to read back afterwards.
 *
 * Man of the match is a single button because the ballot is not a choice the
 * author makes: it is the fixture's real starting XIs. Referee decision opens
 * one row of chips, because "which decision" is genuinely the author's to
 * pick and there is no honest way to infer it.
 */
function TemplatedPollActions({ fixtureId, disabled }: { fixtureId: string; disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [refOpen, setRefOpen] = useState(false);
  const [decision, setDecision] = useState<RefereeDecision | null>(null);
  const [minute, setMinute] = useState("");

  const busy = pending || disabled;

  function startMotm() {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const result = await createMotmPoll(fixtureId);
      if (result.error) setError(result.error);
      else setDone("Man-of-the-match vote posted to the room.");
    });
  }

  function startReferee() {
    if (!decision) return;
    setError(null);
    setDone(null);
    const trimmed = minute.trim();
    startTransition(async () => {
      const result = await createRefereePoll(fixtureId, decision, trimmed === "" ? null : Number(trimmed));
      if (result.error) {
        setError(result.error);
        return;
      }
      setDone("Referee-decision poll posted to the room.");
      setRefOpen(false);
      setDecision(null);
      setMinute("");
    });
  }

  return (
    <div className="flex flex-col gap-1.5 border-b border-hairline-soft pb-2">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={startMotm}
          className="kivo-glass-sharp flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium text-foreground-muted transition-colors hover:text-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <Trophy className="h-3 w-3 shrink-0" strokeWidth={2} />
          Man of the match
        </button>
        <button
          type="button"
          disabled={busy}
          aria-expanded={refOpen}
          onClick={() => {
            setRefOpen((open) => !open);
            setError(null);
            setDone(null);
          }}
          className={`kivo-glass-sharp flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
            refOpen ? "text-accent" : "text-foreground-muted hover:text-foreground"
          }`}
        >
          <Gavel className="h-3 w-3 shrink-0" strokeWidth={2} />
          Referee decision
        </button>
      </div>

      <AnimatePresence initial={false}>
        {refOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-1.5 pt-1">
              <div className="flex flex-wrap gap-1.5">
                {REFEREE_DECISION_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    disabled={busy}
                    aria-pressed={decision === option.id}
                    onClick={() => setDecision(option.id)}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
                      decision === option.id
                        ? "border-transparent bg-accent-strong text-on-accent"
                        : "border-hairline text-foreground-muted hover:bg-surface-2"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  value={minute}
                  onChange={(event) => setMinute(event.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
                  inputMode="numeric"
                  placeholder="Minute (optional)"
                  aria-label="Minute of the decision, optional"
                  className="kivo-focusable min-w-0 flex-1 rounded-lg border border-hairline bg-surface-inset px-2.5 py-1.5 text-xs text-foreground placeholder:text-foreground-subtle focus:border-accent focus:outline-none"
                />
                <button
                  type="button"
                  disabled={busy || !decision}
                  onClick={startReferee}
                  className="kivo-gradient-prime shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  Ask the room
                </button>
              </div>
              <p className="text-[10px] text-foreground-subtle">
                The minute is your own note about which incident you mean — KIVO does not check it against the match
                events, because a disputed decision often is not one.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <p className="text-[11px] text-warning" role="status" aria-live="polite">
          {error}
        </p>
      )}
      {done && (
        <p className="text-[11px] text-live" role="status" aria-live="polite">
          {done}
        </p>
      )}
    </div>
  );
}
