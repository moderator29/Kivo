/**
 * The Transfer Centre's status vocabulary — and the record of why it has one
 * entry rather than four.
 *
 * The founding directive asks for "Confirmed / Reported / Rumour / Unverified"
 * labels. RECOMMENDATIONS.md item 178 formally retired that taxonomy, and the
 * reasoning still holds: KIVO's transfer feed comes from API-Football's
 * `/transfers` endpoint, which returns **completed, recorded moves only**.
 * There is no reported-but-unconfirmed move in the data, no journalist
 * sourcing, and no reliability signal of any kind. Every tier above
 * "Confirmed" would therefore be a label KIVO invented and attached to a row
 * that means something else — a fabricated confidence signal, which is the
 * one thing this product does not do.
 *
 * So there is one status, it is true, and the product says out loud why the
 * other three are missing instead of quietly having fewer filters than the
 * spec. `TRANSFER_STATUS_EXPLAINER` is that sentence, rendered on both
 * `/transfers` and every transfer's own page — a user who was promised rumour
 * tiers deserves the reason, not a shrug.
 *
 * What would change this: a licensed news or journalist feed with its own
 * reliability metadata. At that point the tiers describe something real and
 * the taxonomy can come back, keyed off the source's own signal rather than
 * KIVO's opinion. Until then, one label.
 */

export const TRANSFER_STATUS_LABEL = "Confirmed" as const;

export const TRANSFER_STATUS_EXPLAINER =
  "Every move here is already done. KIVO's transfer data covers completed, recorded transfers only — there is no rumour or reported tier, because there is no real signal behind one. Adding those labels would mean inventing them.";

/** The shorter version, for a chip's tooltip or a dense list footer. */
export const TRANSFER_STATUS_SHORT_EXPLAINER = "Completed moves only. No rumours, because KIVO has no rumour source.";
