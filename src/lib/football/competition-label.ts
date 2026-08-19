/**
 * How KIVO names a competition on screen, and what it says when it cannot.
 *
 * The founder's report: competitions were rendering as a league nobody could
 * identify. Two separate causes sat behind that, and both were the UI
 * inventing a fact rather than the database losing one.
 *
 * 1. `competitions.country` is null on every row the live provider has synced
 *    so far. Four surfaces rendered `country ?? "International"`, which turns
 *    "KIVO does not know where this competition is played" into the positive
 *    claim "this is an international competition" — false for a domestic cup
 *    and unfalsifiable to a reader, because the screen looks identical either
 *    way. Whether the provider supplies the field at all is a data-pipeline
 *    question somebody else owns; what the UI owes in the meantime is silence,
 *    not a guess.
 *
 * 2. A handful of call sites rendered `name ?? "Unknown competition"`. The
 *    word "Unknown" reads as a name — it is what a user sees where a league's
 *    name goes — and a label that is not a name should not occupy the place a
 *    name occupies.
 *
 * So both answers here are `string | null`, and null means *render nothing*.
 * A missing subtitle is a smaller lie than a wrong one, and an absent line is
 * the only honest rendering of an absent fact.
 */

/** The provider's own shape for a competition, as every list query selects it. */
export type CompetitionNaming = {
  name?: string | null;
  short_name?: string | null;
} | null;

/**
 * The competition's name, preferring the short form where a caller asks for
 * it (a row label has less room than a page heading). Null when the row
 * carries no name at all — the caller renders nothing rather than a
 * placeholder that looks like a name.
 */
export function competitionName(
  competition: CompetitionNaming,
  prefer: "full" | "short" = "full",
): string | null {
  if (!competition) return null;
  const full = competition.name?.trim() || null;
  const short = competition.short_name?.trim() || null;
  return prefer === "short" ? short ?? full : full ?? short;
}

/**
 * The subtitle under a competition's name: its country, the season, or both,
 * joined the way the rest of the app joins metadata. Every part is optional
 * and an absent part is simply absent — with no parts at all the answer is
 * null and the line does not render.
 *
 * Deliberately no "International" default for a null country. See this
 * module's own note: a null country is missing information, and an
 * international competition is a fact about football. They are not the same
 * thing and must not print the same string.
 */
export function competitionMetaLine(parts: Array<string | null | undefined>): string | null {
  const kept = parts.map((part) => part?.trim() || null).filter((part): part is string => part !== null);
  return kept.length > 0 ? kept.join(" · ") : null;
}
