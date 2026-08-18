/**
 * Turning "how did arsenal do against spurs" into a small set of phrases worth
 * looking up. Pure and dependency-free so it can be unit-tested directly — the
 * database half lives in `entity-resolution.ts`.
 *
 * KIVO_NEXT_GEN KN-108: the Copilot's grounding is built entirely from the
 * viewer's own follows and today's fixtures, so asking about a real team KIVO
 * has synced but the viewer does not follow gets "KIVO doesn't have that" — a
 * false statement about the platform's own database, which is a worse failure
 * on this product than on most.
 *
 * The approach is deliberately dumb, and that is the point. No capitalisation
 * heuristics (people type "arsenal", and half the world's clubs are two lowercase
 * words in a chat message), no model call, no NER dependency. Emit every
 * plausible 1-3 word span, let Postgres's trigram indexes decide what is
 * actually a football entity, and let the similarity threshold reject the rest.
 * Cheap enough to be deterministic and deterministic enough to be safe: the
 * model never chooses what gets looked up, so it cannot talk KIVO into
 * retrieving something.
 */

/**
 * Words that are never worth a lookup on their own and never worth starting or
 * ending a phrase with. Two groups, kept separate in the source for a reason:
 * ordinary English function words, and football words so generic that they
 * would trigram-match dozens of clubs ("united", "city", "real", "athletic"
 * appear in more club names than any single query should resolve to).
 *
 * The two groups are applied differently, which is the whole trick: a function
 * word can never sit at either end of a phrase, but a generic football word
 * only disqualifies a *single-word* phrase. So "united" on its own is never
 * looked up, "manchester united" is, and "how did manchester united" never
 * starts with "how".
 */
const FUNCTION_WORDS = new Set([
  "a", "an", "and", "any", "are", "as", "at", "be", "been", "but", "by", "can", "could", "did", "do", "does",
  "doing", "done", "for", "from", "get", "getting", "gets", "had", "has", "have", "how", "i", "if", "in", "into",
  "is", "it", "its", "just", "many", "me", "much", "my", "no", "not", "of", "on", "or", "our", "out", "over",
  "should", "so", "some", "than", "that", "the", "their", "them", "then", "there", "these", "they", "this",
  "those", "to", "up", "us", "was", "we", "were", "what", "when", "where", "which", "who", "why", "will", "with",
  "would", "you", "your",
]);

const GENERIC_FOOTBALL_WORDS = new Set([
  "athletic", "away", "club", "cup", "city", "fc", "form", "game", "games", "goal", "goals", "home",
  "international", "league", "match", "matches", "player", "players", "playing", "real", "record", "results",
  "score", "scores", "season", "sporting", "squad", "stats", "table", "team", "teams", "united", "vs", "win",
  "wins", "won",
]);

/** Longest phrase considered. Three words covers "manchester united",
 * "borussia monchengladbach", "real madrid cf" and effectively every club and
 * player name in a chat message; four-word spans mostly add noise. */
const MAX_PHRASE_WORDS = 3;

/** Hard ceiling on phrases sent to the database. One array parameter, one
 * query — but a long message should still not be able to make that query
 * arbitrarily wide. Longer phrases are kept first because they are the
 * specific ones. */
export const MAX_MENTION_PHRASES = 12;

/** Below three characters a lone trigram match is noise, not a name. Inside a
 * multi-word phrase two characters is fine — "fc porto", "ac milan". */
const MIN_LONE_WORD_LENGTH = 3;
const MIN_BOUNDARY_WORD_LENGTH = 2;

function tokenize(message: string): string[] {
  return message
    .toLowerCase()
    // Keep letters (including accented ones), digits, apostrophes and hyphens;
    // everything else is a separator. `\p{L}` rather than `a-z` because club and
    // player names are full of characters that are not ASCII.
    .replace(/[^\p{L}\p{N}'-]+/gu, " ")
    .split(" ")
    .filter(Boolean);
}

/** Can this word be a lone phrase all by itself? */
function isStandalonePhraseWord(word: string): boolean {
  return word.length >= MIN_LONE_WORD_LENGTH && !FUNCTION_WORDS.has(word) && !GENERIC_FOOTBALL_WORDS.has(word);
}

/** Can this word sit at either end of a multi-word phrase? */
function isBoundaryWord(word: string): boolean {
  return word.length >= MIN_BOUNDARY_WORD_LENGTH && !FUNCTION_WORDS.has(word);
}

/**
 * Every 1-3 word span of the message whose ends could plausibly be part of a
 * name, longest first, de-duplicated and capped.
 *
 * Longest-first matters: the cap keeps the specific phrases ("manchester
 * united") and drops the vague ones ("manchester") when a message is long
 * enough to hit it. Purely numeric spans are dropped — a scoreline is not a
 * name.
 */
export function extractMentionPhrases(message: string): string[] {
  const words = tokenize(message);
  const phrases: string[] = [];

  for (let size = MAX_PHRASE_WORDS; size >= 1; size -= 1) {
    for (let start = 0; start + size <= words.length; start += 1) {
      const span = words.slice(start, start + size);
      if (size === 1) {
        if (!isStandalonePhraseWord(span[0])) continue;
      } else if (!isBoundaryWord(span[0]) || !isBoundaryWord(span[span.length - 1])) {
        continue;
      }
      if (span.every((word) => /^\p{N}+$/u.test(word))) continue;
      phrases.push(span.join(" "));
    }
  }

  return [...new Set(phrases)].slice(0, MAX_MENTION_PHRASES);
}
