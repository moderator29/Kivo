/**
 * Single source of truth for the KIVO-native avatar/background asset ids.
 *
 * AVATARS — all 18 of the founder's commissioned set ship. They are exported
 * as whole 384x384 panels, one per design, sliced straight off the three
 * source sheets in `design/raw-uploads/founder-screenshots/` (six designs per
 * sheet, an exact 3x2 grid of 512px cells, downsampled to 384 because 116px
 * at DPR 3 is the largest any surface renders one). No sub-crop is applied to
 * any of them any more: an earlier pass shipped only the 5 whose corner
 * watermark could be trimmed away and then cropped each of those to a
 * head-and-shoulders box, which is why the picker offered five unrecognisable
 * slivers. The founder's instruction is the opposite — every design, shown
 * whole, exactly as the artwork was composed. `RECOMMENDATIONS.md` items
 * 231/232/233 and `KIVO_NEXT_GEN.md` KN-156 all describe the old
 * five-and-cropped world and are superseded by that decision for avatars.
 *
 * The three `profiles` check constraints from
 * supabase/migrations/0043_kivo_avatar_background_system.sql encode the same
 * lists at the database layer as defense-in-depth; migration 0109 widens the
 * avatar one from 5 ids to these 18. Kept in sync by hand with this file,
 * same "duplicated literal" precedent as MAX_BIO_LENGTH in
 * src/app/(app)/settings/actions.ts.
 *
 * BACKGROUNDS are unchanged — items 231/232 still hold there, because the two
 * excluded covers have KIVO rendered as content inside the scene rather than
 * as a corner overlay.
 */
export const KIVO_AVATAR_IDS = [
  "kivo-avatar-01",
  "kivo-avatar-02",
  "kivo-avatar-03",
  "kivo-avatar-04",
  "kivo-avatar-05",
  "kivo-avatar-06",
  "kivo-avatar-07",
  "kivo-avatar-08",
  "kivo-avatar-09",
  "kivo-avatar-10",
  "kivo-avatar-11",
  "kivo-avatar-12",
  "kivo-avatar-13",
  "kivo-avatar-14",
  "kivo-avatar-15",
  "kivo-avatar-16",
  "kivo-avatar-17",
  "kivo-avatar-18",
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
 * A short, human description of each KIVO avatar's artwork.
 *
 * This exists so that an avatar is never announced, labelled or alt-texted as
 * a number. Screen-reader users get the same information a sighted user gets
 * from looking at the tile ("a goalkeeper in green holding the ball"), the
 * picker's 18 options are distinguishable from one another in the
 * accessibility tree rather than eighteen identical "Choose this KIVO
 * avatar" buttons, and nothing in the UI ever exposes the asset id.
 *
 * Written by looking at each exported file, not inferred from its filename.
 */
export const KIVO_AVATAR_DESCRIPTIONS: Record<KivoAvatarId, string> = {
  "kivo-avatar-01": "Forward in a flowing cape, holding the ball, back to the camera",
  "kivo-avatar-02": "Player in a visor crouching with one hand resting on the ball",
  "kivo-avatar-03": "Player in sunglasses pointing out to the crowd, ball under one arm",
  "kivo-avatar-04": "Player in a white kit striking the ball at full stretch",
  "kivo-avatar-05": "Hooded player hooking a volley out of the air",
  "kivo-avatar-06": "Player with bleached hair facing the pitch under stadium lights",
  "kivo-avatar-07": "Player in a headband driving the ball forward at pace",
  "kivo-avatar-08": "Player in a white kit carrying the ball, back to the camera",
  "kivo-avatar-09": "Player striking a volley through a burst of light",
  "kivo-avatar-10": "Player with silver hair sprinting with the ball under floodlights",
  "kivo-avatar-11": "Player in a white kit turning to flex a celebration",
  "kivo-avatar-12": "Player standing with folded arms in front of glowing match data",
  "kivo-avatar-13": "Player seated on a bench with a foot on the ball",
  "kivo-avatar-14": "Player in a white kit running the ball through streaks of colour",
  "kivo-avatar-15": "Goalkeeper in green gloves holding the ball in front of the net",
  "kivo-avatar-16": "Player crouched beside the ball against a glowing globe",
  "kivo-avatar-17": "Player in a white kit glancing back in front of tactics boards",
  "kivo-avatar-18": "Player with long braids holding the ball, silver K behind her",
};

/**
 * The description for whatever `resolveAvatarSrc` produced, or null when the
 * src is a user's own upload / the legacy avatar_url / nothing.
 *
 * Derived from the path rather than from a second `kivoId` prop threaded
 * through every call site: `kivoAvatarPath` is the only thing that ever
 * produces these URLs, so the path IS the id, and reading it back here means
 * every avatar in the app can describe itself without any caller changing.
 */
export function kivoAvatarDescriptionForSrc(src: string | null | undefined) {
  if (!src) return null;
  const match = /\/assets\/kivo\/avatars\/([a-z0-9-]+)\.webp$/.exec(src);
  const id = match?.[1];
  return isKivoAvatarId(id) ? KIVO_AVATAR_DESCRIPTIONS[id] : null;
}
