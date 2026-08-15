/**
 * The six `reaction_type` enum values from
 * supabase/migrations/0001_kivo_core_schema.sql, plus the emoji + label the
 * UI shows for each. Single source of truth so the reaction picker
 * (components/social/reaction-picker.tsx) and the server-side aggregation
 * below can't drift from the DB enum or from each other.
 */
export const REACTIONS = [
  { type: "like", emoji: "👍", label: "Like" },
  { type: "fire", emoji: "🔥", label: "Fire" },
  { type: "clap", emoji: "👏", label: "Clap" },
  { type: "laugh", emoji: "😂", label: "Laugh" },
  { type: "wow", emoji: "😮", label: "Wow" },
  { type: "sad", emoji: "😢", label: "Sad" },
] as const;

export type ReactionType = (typeof REACTIONS)[number]["type"];

const REACTION_BY_TYPE = new Map(REACTIONS.map((r) => [r.type, r]));

export function isReactionType(value: string): value is ReactionType {
  return REACTION_BY_TYPE.has(value as ReactionType);
}

export function reactionEmoji(type: ReactionType): string {
  return REACTION_BY_TYPE.get(type)!.emoji;
}

export type ReactionSummary = { count: number; viewerReaction: ReactionType | null };

/**
 * Rolls a flat list of reaction rows (one row per user per target) up into
 * per-target totals. The displayed count is a single sum across all six
 * types — see RECOMMENDATIONS item 14 — with the viewer's own reaction type
 * tracked separately so the UI can highlight it.
 */
export function aggregateReactions(
  rows: { target_id: string; profile_id: string; reaction_type: ReactionType }[],
  viewerProfileId: string | null,
): Map<string, ReactionSummary> {
  const map = new Map<string, ReactionSummary>();
  for (const row of rows) {
    const entry = map.get(row.target_id) ?? { count: 0, viewerReaction: null };
    entry.count += 1;
    if (viewerProfileId && row.profile_id === viewerProfileId) entry.viewerReaction = row.reaction_type;
    map.set(row.target_id, entry);
  }
  return map;
}
