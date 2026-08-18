import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * The single description of everything KIVO stores about one person.
 *
 * KIVO_NEXT_GEN KN-112 asks for a "your data" dashboard extending the existing
 * export. Building it surfaced something worth fixing first: `exportUserData`
 * covered posts, comments, predictions, fantasy teams and rosters, follows,
 * saves, badges and the XP ledger — and silently omitted eight other tables
 * that hold real user data (reactions, poll votes, match ratings, AI
 * conversations and their messages, notification preferences, notifications,
 * and support requests). A feature whose button says "Download my data" is
 * exactly the wrong place for an incomplete answer, on a platform whose first
 * rule is not asserting things it hasn't checked.
 *
 * So this list is the source of truth for both surfaces — the dashboard counts
 * these categories and the export writes these categories. Adding a
 * user-owned table means adding one entry here, and both stay correct.
 *
 * `notifications` is included deliberately even though KIVO generates it rather
 * than the user: it is a record of what the platform sent to this person, which
 * is theirs to see. Rows KIVO holds *about* a user that are not theirs to read
 * (moderation decisions, audit_log entries) are not here and must not be —
 * those are readable by admins through `/admin`, and RLS is what enforces the
 * difference, not this list.
 */
export const USER_DATA_CATEGORIES = [
  { key: "posts", label: "Posts", description: "Posts and polls you've published." },
  { key: "comments", label: "Comments", description: "Replies you've written on posts." },
  { key: "reactions", label: "Reactions", description: "Reactions you've left on posts and comments." },
  { key: "pollVotes", label: "Poll votes", description: "Votes you've cast in community polls." },
  { key: "predictions", label: "Predictions", description: "Match calls you've made, and their results." },
  { key: "fanRatings", label: "Match ratings", description: "Player and match ratings you've submitted." },
  { key: "fantasyTeams", label: "Fantasy teams", description: "Fantasy squads you own." },
  { key: "fantasyRosters", label: "Fantasy selections", description: "Gameweek-by-gameweek squad selections." },
  { key: "follows", label: "Follows", description: "Teams, players, competitions and people you follow." },
  { key: "saves", label: "Saves", description: "Posts, teams and players you've saved." },
  { key: "badges", label: "Badges", description: "Badges you've earned." },
  { key: "xpLedger", label: "XP entries", description: "Every XP award, with what earned it." },
  { key: "aiConversations", label: "Copilot chats", description: "Conversations you've started with the Copilot." },
  { key: "aiMessages", label: "Copilot messages", description: "Messages in those conversations, yours and KIVO's." },
  { key: "notifications", label: "Notifications", description: "In-app notifications KIVO has sent you." },
  {
    key: "notificationPreferences",
    label: "Notification settings",
    description: "Your saved choices about what KIVO may notify you about.",
  },
  { key: "supportRequests", label: "Support requests", description: "Messages you've sent to KIVO support." },
] as const;

export type UserDataCategoryKey = (typeof USER_DATA_CATEGORIES)[number]["key"];

/**
 * A count of `null` means "we could not read this right now", never zero.
 * Showing 0 for a failed count would be the dashboard telling someone KIVO
 * holds nothing of theirs when it may hold plenty — a fabricated fact in the
 * one place whose entire purpose is telling the truth about their data.
 */
export type UserDataCounts = Record<UserDataCategoryKey, number | null>;

export interface UserDataSummary {
  counts: UserDataCounts;
  /** Real total across the XP ledger, via get_xp_total — null if unreadable. */
  totalXp: number | null;
  /** profiles.created_at — when this account started existing. */
  memberSince: string | null;
}

type Client = SupabaseClient<Database>;

/** `head: true` + `count: "exact"` transfers no rows at all — just the count
 * header. Every filter below is on an indexed owner column. */
async function countRows(
  supabase: Client,
  run: () => PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number | null> {
  const { count, error } = await run();
  return error ? null : (count ?? 0);
}

/**
 * Reads through the caller's own RLS-enforced client, exactly like
 * `exportUserData` does. That is not incidental: it means the dashboard can
 * only ever show counts of rows this person is genuinely allowed to read, so
 * the number on screen and the rows in the export cannot disagree.
 */
export async function getUserDataSummary(supabase: Client, profileId: string): Promise<UserDataSummary> {
  // fantasy_rosters and ai_messages have no owner column of their own — they
  // hang off fantasy_teams and ai_conversations respectively — so their parents
  // are resolved first. Both are small sets by construction.
  const [{ data: fantasyTeamRows }, { data: conversationRows }] = await Promise.all([
    supabase.from("fantasy_teams").select("id").eq("owner_profile_id", profileId),
    supabase.from("ai_conversations").select("id").eq("profile_id", profileId),
  ]);
  const fantasyTeamIds = (fantasyTeamRows ?? []).map((r) => r.id);
  const conversationIds = (conversationRows ?? []).map((r) => r.id);

  const [
    posts,
    comments,
    reactions,
    pollVotes,
    predictions,
    fanRatings,
    fantasyRosters,
    follows,
    saves,
    badges,
    xpLedger,
    aiMessages,
    notifications,
    notificationPreferences,
    supportRequests,
    xpTotalResult,
    profileRow,
  ] = await Promise.all([
    countRows(supabase, () =>
      supabase.from("posts").select("id", { count: "exact", head: true }).eq("author_profile_id", profileId),
    ),
    countRows(supabase, () =>
      supabase.from("comments").select("id", { count: "exact", head: true }).eq("author_profile_id", profileId),
    ),
    countRows(supabase, () =>
      supabase.from("reactions").select("id", { count: "exact", head: true }).eq("profile_id", profileId),
    ),
    countRows(supabase, () =>
      supabase.from("poll_votes").select("id", { count: "exact", head: true }).eq("profile_id", profileId),
    ),
    countRows(supabase, () =>
      supabase.from("predictions").select("id", { count: "exact", head: true }).eq("profile_id", profileId),
    ),
    countRows(supabase, () =>
      supabase.from("fan_ratings").select("id", { count: "exact", head: true }).eq("profile_id", profileId),
    ),
    fantasyTeamIds.length
      ? countRows(supabase, () =>
          supabase
            .from("fantasy_rosters")
            .select("id", { count: "exact", head: true })
            .in("fantasy_team_id", fantasyTeamIds),
        )
      : Promise.resolve(0),
    countRows(supabase, () =>
      supabase.from("follows").select("id", { count: "exact", head: true }).eq("follower_profile_id", profileId),
    ),
    countRows(supabase, () =>
      supabase.from("saves").select("id", { count: "exact", head: true }).eq("profile_id", profileId),
    ),
    countRows(supabase, () =>
      supabase.from("user_badges").select("badge_id", { count: "exact", head: true }).eq("profile_id", profileId),
    ),
    countRows(supabase, () =>
      supabase.from("xp_ledger").select("id", { count: "exact", head: true }).eq("profile_id", profileId),
    ),
    conversationIds.length
      ? countRows(supabase, () =>
          supabase.from("ai_messages").select("id", { count: "exact", head: true }).in("conversation_id", conversationIds),
        )
      : Promise.resolve(0),
    countRows(supabase, () =>
      supabase.from("notifications").select("id", { count: "exact", head: true }).eq("profile_id", profileId),
    ),
    countRows(supabase, () =>
      supabase
        .from("notification_preferences")
        .select("profile_id", { count: "exact", head: true })
        .eq("profile_id", profileId),
    ),
    countRows(supabase, () =>
      supabase.from("support_requests").select("id", { count: "exact", head: true }).eq("profile_id", profileId),
    ),
    supabase.rpc("get_xp_total", { p_profile_id: profileId }),
    supabase.from("profiles").select("created_at").eq("id", profileId).maybeSingle(),
  ]);

  return {
    counts: {
      posts,
      comments,
      reactions,
      pollVotes,
      predictions,
      fanRatings,
      fantasyTeams: fantasyTeamRows ? fantasyTeamIds.length : null,
      fantasyRosters,
      follows,
      saves,
      badges,
      xpLedger,
      aiConversations: conversationRows ? conversationIds.length : null,
      aiMessages,
      notifications,
      notificationPreferences,
      supportRequests,
    },
    totalXp: xpTotalResult.error ? null : (xpTotalResult.data ?? 0),
    memberSince: profileRow.data?.created_at ?? null,
  };
}
