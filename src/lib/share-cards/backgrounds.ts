/**
 * The backgrounds a share card can be rendered on.
 *
 * The founder's instruction was explicit: a card renders **on top of a chosen
 * background**, not in one hardcoded look, with a horizontal strip of
 * thumbnails that restyle the card live and a "+" tile at the end. KIVO
 * already owns two background systems and this reuses both rather than
 * inventing a third:
 *
 *   1. `KIVO_BACKGROUND_IDS` — the ten confirmed-clean KIVO backgrounds that
 *      a profile cover picks from (migration 0043 / RECOMMENDATIONS 231-232).
 *   2. `profiles.background_uploaded_url` — the user's own uploaded cover
 *      (migration 0065). That is what the "+" tile writes to, which means
 *      uploading a share background also sets your profile cover. That is a
 *      real side effect, not a bug, and the sheet says so out loud rather
 *      than surprising anyone — the alternative was a second upload column
 *      and a second Storage convention for the same picture.
 *
 * Plus one background that is not an image at all: `signature`, KIVO's own
 * gradient, drawn in code. It exists so the picker has a guaranteed-present
 * default that costs no bytes and never fails to decode, and so a card made
 * before any assets load still looks like KIVO.
 */

import { KIVO_BACKGROUND_IDS, kivoBackgroundPath, type KivoBackgroundId } from "@/lib/kivo-assets";

/** The id the picker and the image route both speak. */
export type ShareBackgroundId = "signature" | KivoBackgroundId | "own";

export const SIGNATURE_BACKGROUND_ID = "signature" as const;
export const OWN_BACKGROUND_ID = "own" as const;

export type ShareBackground = {
  id: ShareBackgroundId;
  label: string;
  /** What the browser loads for the thumbnail and the live preview. `null`
   * for `signature` (drawn as a gradient) and for `own` until the viewer
   * actually has an uploaded cover. */
  previewSrc: string | null;
};

/**
 * The JPEG derivative the image route reads, for a KIVO background id.
 *
 * `next/og`'s rasteriser cannot decode WEBP (verified for real on the match
 * card: a WEBP data URI throws "u2 is not iterable" inside resvg, the same
 * pixels as PNG render cleanly). The originals stay WEBP for the browser;
 * `scripts/generate-share-card-backgrounds.mjs` produces these square JPEGs
 * for the renderer alone. Nothing in the browser ever requests this path.
 */
export function shareBackgroundImagePath(id: KivoBackgroundId): string {
  return `/assets/kivo/share-cards/backgrounds/${id}.jpg`;
}

export function isKivoShareBackgroundId(id: string): id is KivoBackgroundId {
  return (KIVO_BACKGROUND_IDS as readonly string[]).includes(id);
}

export function isShareBackgroundId(id: string | null | undefined): id is ShareBackgroundId {
  if (!id) return false;
  return id === SIGNATURE_BACKGROUND_ID || id === OWN_BACKGROUND_ID || isKivoShareBackgroundId(id);
}

/**
 * The picker's full list, in order: KIVO's own gradient first (the default),
 * then the ten backgrounds, then the viewer's upload if they have one. The
 * "+" tile is rendered by the sheet, not listed here — it is an action, not a
 * background.
 */
export function listShareBackgrounds(uploadedUrl: string | null): ShareBackground[] {
  const backgrounds: ShareBackground[] = [
    { id: SIGNATURE_BACKGROUND_ID, label: "KIVO", previewSrc: null },
    ...KIVO_BACKGROUND_IDS.map((id) => ({
      id: id as ShareBackgroundId,
      label: id.replace("kivo-bg-", "Cover "),
      previewSrc: kivoBackgroundPath(id),
    })),
  ];
  if (uploadedUrl) {
    backgrounds.push({ id: OWN_BACKGROUND_ID, label: "Yours", previewSrc: uploadedUrl });
  }
  return backgrounds;
}

/**
 * The gradient stack drawn under every card. Two layers, and both matter:
 *
 *   - `base` is what `signature` shows on its own, and what sits underneath a
 *     photo background so that a failed or slow image never leaves a card on
 *     bare white.
 *   - `scrim` is drawn *over* any image background. The KIVO backgrounds are
 *     busy AI renders and the source art is 512x420 upscaled to 1080 square,
 *     so putting a scoreline straight onto one would be both illegible and
 *     visibly soft. Everything readable on a card sits on a panel above this.
 */
export const SHARE_BACKGROUND_LAYERS = {
  base: "linear-gradient(160deg, #05060a 0%, #0a1020 45%, #131a3a 100%)",
  scrim: "linear-gradient(180deg, rgba(5,6,10,0.62) 0%, rgba(5,6,10,0.78) 55%, rgba(5,6,10,0.92) 100%)",
  /** Drawn over `base` when there is no image — KIVO's blue-to-violet energy,
   * kept low-contrast so it reads as depth behind the panels rather than as a
   * second thing competing with them. Without it the signature card is a flat
   * near-black square, which is not the same as restraint. */
  signatureGlow:
    "radial-gradient(circle at 22% 18%, rgba(37,99,255,0.30) 0%, rgba(37,99,255,0) 46%), radial-gradient(circle at 84% 78%, rgba(124,63,255,0.26) 0%, rgba(124,63,255,0) 44%)",
} as const;
