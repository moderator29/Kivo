/**
 * The vocabulary of KIVO's two templated Match Room polls.
 *
 * Lives here rather than in the server action because a `"use server"` file
 * may only export async functions, and both the composer (client) and the
 * action (server) need the same list — a decision the composer offers that
 * the action does not accept is a bug that only shows up when someone taps it.
 */

export type RefereeDecision = "penalty" | "red_card" | "offside" | "disallowed_goal" | "var_review";

export type RefereeDecisionOption = {
  id: RefereeDecision;
  /** The chip's own label in the composer. */
  label: string;
  /** How the decision reads inside the composed question. */
  phrase: string;
};

/**
 * A fixed list, not free text, and that is the "structured" half of what the
 * founding brief asks for. Twenty phrasings of "was that a pen??" are twenty
 * incomparable polls; five decisions are five things a room can actually be
 * asked about the same way twice.
 *
 * These five are the decisions that actually get argued about — every one of
 * them is a moment a referee visibly decides something, rather than a
 * judgement about a player.
 */
export const REFEREE_DECISION_OPTIONS: RefereeDecisionOption[] = [
  { id: "penalty", label: "Penalty", phrase: "the penalty decision" },
  { id: "red_card", label: "Red card", phrase: "the red card" },
  { id: "offside", label: "Offside", phrase: "the offside call" },
  { id: "disallowed_goal", label: "Disallowed goal", phrase: "the disallowed goal" },
  { id: "var_review", label: "VAR review", phrase: "the VAR review" },
];

/**
 * Composes the question a referee-decision poll asks.
 *
 * The minute is included only when the author actually supplied one — a
 * question that says "in the 0'" when nobody said 0 would be KIVO stating a
 * fact it was never told. It is also explicitly the author's claim about
 * when, not a synced event: nothing here reads `fixture_events`, because a
 * disputed decision very often is not one.
 */
export function refereeDecisionQuestion(decision: RefereeDecision, minute: number | null): string {
  const option = REFEREE_DECISION_OPTIONS.find((candidate) => candidate.id === decision);
  const phrase = option?.phrase ?? "that decision";
  return minute === null ? `Was ${phrase} right?` : `Was ${phrase} on ${minute}' right?`;
}

/** Human label for a poll kind, for the chip PostCard renders above a
 * templated poll. */
export const POLL_KIND_LABEL: Record<"motm" | "referee_decision", string> = {
  motm: "Man of the match",
  referee_decision: "Referee decision",
};
