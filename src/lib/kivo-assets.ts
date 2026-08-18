/**
 * Single source of truth for the KIVO-native avatar/background asset ids —
 * RECOMMENDATIONS.md items 231/232. Only these ids are "confirmed clean"
 * (no baked-in wordmark/number overlapping the art); the rest of each batch
 * needs a remastered source before it can ship. Every picker, random
 * assignment, and resolver in the app imports these two lists rather than
 * repeating them, so there is exactly one place to update if/when items
 * 231/232 land more clean assets.
 *
 * The three `profiles` check constraints added in
 * supabase/migrations/0043_kivo_avatar_background_system.sql encode the same
 * two lists at the database layer as defense-in-depth — kept in sync by hand
 * with these, same "duplicated literal" precedent as MAX_BIO_LENGTH in
 * src/app/(app)/settings/actions.ts.
 */
export const KIVO_AVATAR_IDS = [
  "kivo-avatar-06",
  "kivo-avatar-08",
  "kivo-avatar-11",
  "kivo-avatar-12",
  "kivo-avatar-17",
] as const;

export type KivoAvatarId = (typeof KIVO_AVATAR_IDS)[number];

export const KIVO_BACKGROUND_IDS = [
  "kivo-bg-01",
  "kivo-bg-02",
  "kivo-bg-04",
  "kivo-bg-05",
  "kivo-bg-07",
  "kivo-bg-08",
  "kivo-bg-09",
  "kivo-bg-10",
  "kivo-bg-11",
  "kivo-bg-12",
] as const;

export type KivoBackgroundId = (typeof KIVO_BACKGROUND_IDS)[number];

export function isKivoAvatarId(id: string | null | undefined): id is KivoAvatarId {
  return !!id && (KIVO_AVATAR_IDS as readonly string[]).includes(id);
}

export function isKivoBackgroundId(id: string | null | undefined): id is KivoBackgroundId {
  return !!id && (KIVO_BACKGROUND_IDS as readonly string[]).includes(id);
}

export function kivoAvatarPath(id: KivoAvatarId): string {
  return `/assets/kivo/avatars/${id}.webp`;
}

export function kivoBackgroundPath(id: KivoBackgroundId): string {
  return `/assets/kivo/backgrounds/${id}.webp`;
}

export const KIVO_MATCH_CARD_BACKGROUND_PATH = "/assets/kivo/match-card/kivo-match-card-background.webp";

/** Uniformly random pick, used once at profile creation — never re-rolled. */
export function randomKivoAvatarId(): KivoAvatarId {
  return KIVO_AVATAR_IDS[Math.floor(Math.random() * KIVO_AVATAR_IDS.length)];
}

/**
 * Resolves the REAL active avatar image for any profile shape that carries
 * the four avatar columns (a full `profiles` row, or the narrower shape
 * returned by get_public_profiles/get_public_profile_by_username — both
 * cover the same four fields). `avatar_type='uploaded'` wins with the user's
 * own upload; `avatar_type='kivo'` resolves to the real file for
 * avatar_kivo_id (falling back to null if it's somehow not a confirmed-clean
 * id, e.g. stale data from before a future item-231 change); anything else
 * (a profile that predates this feature, with avatar_kivo_id/avatar_type
 * defaulted but never actually chosen) falls back to the legacy `avatar_url`
 * column — Clerk-synced photos on the handful of pre-2026-08-18 rows; nothing
 * writes it any more — and finally null (render a placeholder).
 */
export function resolveAvatarSrc(profile: {
  avatar_type: "kivo" | "uploaded" | null;
  avatar_kivo_id: string | null;
  avatar_uploaded_url: string | null;
  avatar_url: string | null;
}): string | null {
  if (profile.avatar_type === "uploaded" && profile.avatar_uploaded_url) {
    return profile.avatar_uploaded_url;
  }
  if (profile.avatar_type === "kivo" && isKivoAvatarId(profile.avatar_kivo_id)) {
    return kivoAvatarPath(profile.avatar_kivo_id);
  }
  return profile.avatar_url ?? null;
}

/**
 * Resolves the REAL active cover image for any profile shape carrying the two
 * background columns — a full `profiles` row, or the narrower shape
 * get_public_profile_by_username returns (migration 0065 added
 * `background_uploaded_url` to both the column set and that RPC, so /profile
 * and /u/[username] resolve covers identically).
 *
 * Mirrors resolveAvatarSrc() above, with one deliberate difference: there is
 * no `background_type` discriminator, because "no cover at all" is a real and
 * common state (no default is ever forced — see clearBackground in
 * src/app/(app)/profile/background-actions.ts) and two nullable columns can
 * say that where an enum cannot. `profiles_background_source_exclusive`
 * (migration 0065) guarantees at most one of them is set, so the order of the
 * two branches below is a formality rather than a precedence rule.
 */
export function resolveBackgroundSrc(profile: {
  background_id: string | null;
  background_uploaded_url: string | null;
}): string | null {
  if (profile.background_uploaded_url) return profile.background_uploaded_url;
  if (isKivoBackgroundId(profile.background_id)) return kivoBackgroundPath(profile.background_id);
  return null;
}

/**
 * Where the person actually is inside each KIVO avatar, as a square crop box
 * in the source image's own pixels.
 *
 * These are full-body hero renders, not head-and-shoulders portraits, and the
 * asset's own internal number is printed on the shirt — `kivo-avatar-08` wears
 * an 08. Rendered the obvious way (`object-fit: cover`, centred) the circle
 * lands squarely on that shirt, so the product showed a KIVO asset id to the
 * user at every size from the 40px nav avatar upward. That is the exact thing
 * the asset rules forbid, and it is why an earlier pass had to keep shrinking
 * an avatar rather than let it be seen properly.
 *
 * The fix is a crop, which is the only asset operation permitted here — no
 * redraw, no regeneration, no recolour. Each box was measured against the real
 * file and frames the head above the shirt number; the KIVO wordmark and
 * shoulder mark are brand, not an id, and are allowed to stay. Two of the five
 * (06, 17) are rear-facing renders with no face to frame, so their boxes are
 * the best available head crop rather than a good portrait — see the profile
 * recommendations in KIVO_NEXT_GEN.md for the remaster that would fix that
 * properly.
 *
 * `width`/`height` are the file's real intrinsic dimensions, needed to scale
 * the crop without distorting it. Verified against the committed files, not
 * assumed.
 */
type KivoAvatarFraming = { width: number; height: number; x: number; y: number; side: number };

const KIVO_AVATAR_FRAMING: Record<KivoAvatarId, KivoAvatarFraming> = {
  "kivo-avatar-06": { width: 360, height: 512, x: 169, y: 0, side: 82 },
  "kivo-avatar-08": { width: 250, height: 512, x: 50, y: 0, side: 130 },
  "kivo-avatar-11": { width: 250, height: 512, x: 55, y: 5, side: 135 },
  "kivo-avatar-12": { width: 250, height: 512, x: 75, y: 10, side: 125 },
  "kivo-avatar-17": { width: 380, height: 512, x: 205, y: 0, side: 129 },
};

/**
 * The framing for whatever `resolveAvatarSrc` produced, or null when the src
 * is a user's own upload / the legacy avatar_url / nothing.
 *
 * Deliberately derived from the path rather than from a second `kivoId` prop
 * threaded through every call site: `kivoAvatarPath` is the only thing that
 * ever produces these URLs, so the path IS the id, and reading it back here
 * means every avatar in the app — nav, posts, comments, follow lists — gets
 * the corrected framing without any of those files changing.
 */
export function kivoAvatarFramingForSrc(src: string | null | undefined) {
  if (!src) return null;
  const match = /\/assets\/kivo\/avatars\/([a-z0-9-]+)\.webp$/.exec(src);
  const id = match?.[1];
  return isKivoAvatarId(id) ? KIVO_AVATAR_FRAMING[id] : null;
}
