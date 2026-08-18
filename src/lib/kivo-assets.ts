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
