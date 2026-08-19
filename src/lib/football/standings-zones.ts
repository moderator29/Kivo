/**
 * What a row's place in the table *means*, and where that meaning comes from.
 *
 * ## KIVO does not decide this. The competition does.
 *
 * A league table without zone colouring is a list of numbers; the colour is
 * what turns "4th" into "in the Champions League" and "18th" into "going
 * down". Every serious football product draws it, and the founder named its
 * absence directly.
 *
 * The tempting way to build it is a table of rules in code — "Premier League:
 * 1–4 Champions League, 18–20 relegation". That is an unverifiable football
 * claim compiled into the product. It is wrong the season UEFA changes a
 * coefficient place, wrong for the leagues nobody thought to add, and a reader
 * has no way to tell that it is wrong, because a coloured row looks equally
 * authoritative either way. KIVO does not do that, and this module contains no
 * position numbers at all.
 *
 * Instead the boundary is the competition's own, as stated on the standings
 * row KIVO already stores: a free-text description like
 * "Promotion - Champions League (Group Stage)" or "Relegation - Championship".
 * The competition says where its lines are; this module's only job is to
 * decide which of five colours best carries that sentence to a reader, and to
 * do it in a way that cannot invent a line that was never stated.
 *
 * ## Loose matching, and why an unclassified zone is still shown
 *
 * The descriptions are free text and vary by competition, language and season.
 * Matching is therefore deliberately loose — a substring test, ordered so the
 * more specific reading wins — and anything that matches nothing is classified
 * `other`: **no colour, but the sentence is still true and is still shown** in
 * the table's legend. Dropping an unrecognised description would silently
 * discard a fact the competition stated, which is worse than showing it
 * uncoloured.
 *
 * The row's own text is never rewritten. `label` below is always the
 * competition's exact words.
 */

/**
 * The five treatments a table row can carry, plus `other`.
 *
 * Five and not fifteen: colour is only useful here while a reader can hold the
 * whole key in their head at a glance, and the distinctions that matter to a
 * fan reading a table are "top continental", "other continental", "going up",
 * "still to be decided", "going down".
 */
export type StandingsZoneKind =
  | "champions"
  | "europe"
  | "promotion"
  | "playoff"
  | "relegation"
  | "other";

export type StandingsZone = {
  kind: StandingsZoneKind;
  /** The competition's own words, trimmed and otherwise untouched. */
  label: string;
};

/**
 * Ordered because several real descriptions match more than one term and the
 * first match must be the one a fan would use.
 *
 * "Promotion - Champions League (Group Stage)" contains *promotion*, but it is
 * not a promotion — it is continental qualification, and it is checked first.
 * "Promotion - Championship Play-offs" contains *promotion* too, and it is a
 * play-off: nobody has gone up yet. Only a description whose promotion is
 * unconditional reaches the `promotion` rule.
 */
const RULES: { kind: StandingsZoneKind; test: RegExp }[] = [
  // Top-tier continental. Libertadores is South America's equivalent and is
  // matched here for the same reason, not as an afterthought.
  { kind: "champions", test: /champions\s*league|libertadores/i },
  // Everything else continental: Europa, Conference, Sudamericana, and the
  // older names a provider may still use for an archived season.
  { kind: "europe", test: /europa|conference\s*league|sudamericana|uefa\s*cup|cup\s*winners/i },
  // Before promotion and before relegation: a play-off place is not yet either
  // of them, and colouring it as one asserts an outcome that has not happened.
  { kind: "playoff", test: /play[\s-]?off|play[\s-]?out|barrage|relegation\s*round|championship\s*round/i },
  { kind: "relegation", test: /relegation|relegated|descenso/i },
  { kind: "promotion", test: /promotion|promoted|ascenso/i },
];

/**
 * The zone for one standings row, or null when the competition stated nothing.
 *
 * Null is the normal case for most competitions and every one whose source
 * publishes no description, and it must render as an ordinary uncoloured row —
 * "KIVO does not know where this competition's lines are" and "this row is
 * mid-table" are different facts, and only one of them is safe to draw.
 */
export function classifyStandingsZone(description: string | null | undefined): StandingsZone | null {
  const label = description?.trim();
  if (!label) return null;

  const rule = RULES.find((candidate) => candidate.test.test(label));
  return { kind: rule?.kind ?? "other", label };
}

/**
 * The distinct zones present in one table, in the order they first appear
 * reading top to bottom — which for a table sorted by position is the order a
 * reader meets them, and therefore the order the key should list them in.
 *
 * Keyed by the exact label rather than by kind, because a single table
 * genuinely carries several continental lines ("Champions League (Group
 * Stage)" and "Champions League (Qualification)" are different places) and
 * collapsing them into one key would lose the distinction the competition drew.
 */
export function standingsZoneLegend(zones: (StandingsZone | null)[]): StandingsZone[] {
  const seen = new Set<string>();
  const legend: StandingsZone[] = [];
  for (const zone of zones) {
    if (!zone || seen.has(zone.label)) continue;
    seen.add(zone.label);
    legend.push(zone);
  }
  return legend;
}
