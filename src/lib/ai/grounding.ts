import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/profile";
import { computeTeamForm, computePlayerForm, resolveFixtureResult, type ResolvedResult } from "@/lib/football/form-engine";
import { buildMatchInsights, type MatchInsights } from "@/lib/football/match-intelligence";
import { createTtlCache } from "@/lib/ttl-cache";
import { buildMentionFacts } from "./entity-resolution";

// RECOMMENDATIONS.md item 227: this pass's original enrichment scoped form to
// the favourite team only "to keep this one extra query bounded" — these two
// caps are that same bound applied to followed teams/players instead of
// skipping them, rather than lifted entirely. follows is itself already
// limited to 20 rows above, so this is a bound on top of a bound.
const MAX_FOLLOWED_TEAMS_FOR_FORM = 4;
const MAX_FOLLOWED_PLAYERS_FOR_FORM = 4;

/**
 * RECOMMENDATIONS.md items 184/185: what the user was actually looking at
 * when they hit "Ask AI about this match/team/player" — see
 * `src/components/ai/ask-ai-link.tsx` for the entry points and
 * `/api/ai/chat/route.ts` for how this travels from the client's request
 * body into this call. Kept to exactly the three entities KIVO has a real
 * detail page for; anything else is simply not accepted (see route.ts's
 * validation).
 */
export type GroundingFocus = { type: "fixture" | "team" | "player"; id: string };

export interface GroundingContext {
  /** Rendered as plain text and injected into the system prompt — kept small and structured on purpose. */
  summary: string;
  hasFollowedEntities: boolean;
  hasSyncedFixtures: boolean;
  /** RECOMMENDATIONS.md item 189: everything the "what KIVO knows right now"
   * disclosure panel needs to render without re-deriving it — item 189 asks
   * for `grounding.summary` "verbatim", so this is the same summary string
   * already built for the model, plus the one extra label the panel shows
   * when a focus entity is active. Nothing here is computed a second time. */
  disclosureLabel: string | null;
}

/** One real fact bucket used to build the three labelled sections of the
 * summary below (RECOMMENDATIONS.md item 188: provenance chips need the
 * model to be able to tell, unambiguously, which sentences are raw provider
 * facts, which are KIVO's own derived stats, and which are an explicit
 * "not enough data" disclosure — these three arrays are that distinction
 * made structural instead of implicit). `limited` (item 300) holds the
 * `isSufficientSample`-gated "too few matches synced" sentences that used to
 * live inside `calculated` — real uncertainty, present in the data, but
 * previously invisible as anything other than prose the model may or may not
 * have surfaced. */
type FactLines = { verified: string[]; calculated: string[]; limited: string[]; community: string[] };

function emptyFacts(): FactLines {
  return { verified: [], calculated: [], limited: [], community: [] };
}

/**
 * KIVO_NEXT_GEN KN-109: how many Match Room posts are read into the context for
 * a focused fixture, and how much of each.
 *
 * A Room during a live match is the densest first-party text KIVO owns, and it
 * is the one thing a Copilot can be grounded in that no scores app can copy —
 * it needs no football provider at all. But it is also the only input to this
 * whole file that is *opinion*, so the caps are tight on purpose: enough to
 * characterise what a Room is saying, nowhere near enough to be mistaken for a
 * transcript, and short enough per post that the model has to summarise rather
 * than paste.
 */
const MAX_ROOM_POSTS_FOR_CONTEXT = 25;
const MAX_ROOM_POST_CHARS = 220;

/**
 * KIVO_NEXT_GEN KN-18: `buildGroundingContext` fires one `follows` query, three
 * entity-resolution queries, one fixtures query, `computeTeamForm` for up to
 * four followed teams, `computePlayerForm` for up to four followed players, and
 * `buildMatchInsights` when focused — 15 to 25 queries. It ran in full on
 * **every single chat turn**, on an endpoint that is rate-limited precisely
 * because it is expensive, and essentially nothing it reads can change between
 * two messages a user sends thirty seconds apart.
 *
 * 60 seconds is chosen against what the underlying data actually does, not
 * picked for feel. Every input here changes only when a sync writes — and a
 * sync is either an admin pressing a button or the live worker's minute tick
 * (`docs/LIVE_DATA.md`), so a minute is the finest granularity the data itself
 * has. A live score that is up to a minute behind inside a *conversation* is
 * also not the app's live-score surface: /live and Match Centre both push real
 * Realtime updates and are unaffected by this.
 *
 * Keyed by profile **and** focus, so one user's context can never be served to
 * another and "ask about this match" never reuses the unfocused summary.
 */
const GROUNDING_CACHE_TTL_MS = 60_000;
const GROUNDING_CACHE_MAX_ENTRIES = 500;

/**
 * What the cache actually holds: the *fact lines*, not the assembled prompt
 * block. That distinction is what lets KN-108's per-message entity resolution
 * exist without throwing this cache away — the per-user retrieval below is the
 * expensive, slow-moving part and is shared across a conversation's turns,
 * while the per-message part is small, changes every turn, and is merged in
 * afterwards at the cost of one string join.
 */
interface BaseGrounding {
  identityLines: string[];
  verified: string[];
  calculated: string[];
  limited: string[];
  /** KIVO_NEXT_GEN KN-109: real Match Room posts for a focused fixture. Kept a
   * separate bucket from the three factual ones because it is categorically
   * different — what people said, not what happened. */
  community: string[];
  hasFollowedEntities: boolean;
  hasSyncedFixtures: boolean;
  disclosureLabel: string | null;
  /** Teams the base context already describes, so KN-108 does not spend
   * queries re-describing them and does not put the same club into the prompt
   * twice under two slightly different sentences. */
  describedTeamIds: string[];
}

const groundingCache = createTtlCache<string, BaseGrounding>({
  ttlMs: GROUNDING_CACHE_TTL_MS,
  maxEntries: GROUNDING_CACHE_MAX_ENTRIES,
});

function groundingCacheKey(profileId: string, focus: GroundingFocus | null): string {
  return focus ? `${profileId}:${focus.type}:${focus.id}` : `${profileId}:-`;
}

function assembleSummary(base: {
  identityLines: string[];
  verified: string[];
  calculated: string[];
  limited: string[];
  community: string[];
}): string {
  // RECOMMENDATIONS.md items 188/300: the three labelled sections below are
  // what let the model tag its own claims — see SYSTEM_PROMPT in
  // /api/ai/chat/route.ts for the exact tagging instruction, and
  // src/components/ai/chat.tsx for how the tags render as chips. A line
  // landing in the wrong bucket would just mislabel a chip, never fabricate
  // data — the underlying facts are identical to what this file always
  // computed. KIVO-LIMITED (item 300) makes the existing isSufficientSample
  // uncertainty sentences a structural third bucket instead of prose folded
  // into KIVO-CALCULATED that the model may or may not have visibly surfaced.
  return [
    base.identityLines.join("\n"),
    "",
    "=== VERIFIED KIVO DATA (raw facts synced from the football data provider — cite these with the literal tag [[KIVO-VERIFIED]]) ===",
    base.verified.join("\n"),
    "",
    "=== KIVO-CALCULATED (derived by KIVO's own Form Engine / Match Intelligence from the verified data above — real, not fabricated, but computed rather than a raw provider fact — cite these with the literal tag [[KIVO-CALCULATED]]) ===",
    base.calculated.length > 0 ? base.calculated.join("\n") : "Nothing calculated yet for this conversation.",
    "",
    "=== KIVO-LIMITED (explicitly insufficient real data to compute something reliably — a genuine gap, not a fabricated stat — cite these with the literal tag [[KIVO-LIMITED]]) ===",
    base.limited.length > 0 ? base.limited.join("\n") : "No known data-insufficiency gaps for this conversation.",
    "",
    // KIVO_NEXT_GEN KN-109. This section is the only part of the whole context
    // that is not a fact, and the header says so in the strongest terms the
    // format allows, because the model reads this header every turn. Provenance
    // in this product is structural — three buckets that mean three different
    // kinds of true — and community opinion had to become a fourth bucket
    // rather than be folded into one of them, or "KIVO users think City deserved
    // it" and "City had 61% possession" would arrive tagged identically.
    "=== KIVO-COMMUNITY (real posts KIVO users wrote in this match's Room — OPINION, never fact. These are what people SAID, not what happened. Never state one as a fact, never let one contradict or override the VERIFIED section, and never repeat a claim about the match from here as if KIVO had verified it. Summarise the mood or the recurring themes rather than listing posts. If you quote or paraphrase one person, name their @username. Prefix any sentence describing what people in the Room are saying with the literal tag [[KIVO-COMMUNITY]]) ===",
    base.community.length > 0
      ? base.community.join("\n")
      : "No Match Room posts are in context for this conversation.",
  ].join("\n");
}

const NO_USER_CONTEXT: GroundingContext = {
  summary: "No signed-in user context available.",
  hasFollowedEntities: false,
  hasSyncedFixtures: false,
  disclosureLabel: null,
};

/**
 * Deterministic retrieval BEFORE the model ever runs, per the grounding
 * architecture: we tell the model exactly what KIVO actually knows right
 * now, and the system prompt (see chat route) forbids it from answering
 * specific/current football questions with anything outside this context.
 *
 * The per-user half is cached for a short window per (profile, focus) — see
 * GROUNDING_CACHE_TTL_MS above for why that is safe and why it matters.
 *
 * `userMessage` (KIVO_NEXT_GEN KN-108) adds one deterministic step on top: the
 * football entities the user actually named, resolved against KIVO's own
 * tables, whether or not they follow them. Without it, asking about a club KIVO
 * has synced but the viewer doesn't follow produces a confident "KIVO doesn't
 * have that" — a false claim about KIVO's own database. Never cached, because
 * it is different every turn by definition, and cheap enough not to need to be.
 */
export async function buildGroundingContext(
  profile: Profile | null,
  focus: GroundingFocus | null = null,
  userMessage?: string,
): Promise<GroundingContext> {
  if (!profile) return NO_USER_CONTEXT;

  const base = await groundingCache.getOrCreate(groundingCacheKey(profile.id, focus), () =>
    buildBaseGrounding(profile, focus),
  );

  const verified = [...base.verified];
  const calculated = [...base.calculated];
  const limited = [...base.limited];
  // Not extended by mention facts: KN-108 resolves entities, never conversation.
  const community = base.community;

  if (userMessage) {
    const mentions = await buildMentionFacts(
      createServerSupabaseClient(),
      userMessage,
      new Set(base.describedTeamIds),
    );
    verified.push(...mentions.verified);
    calculated.push(...mentions.calculated);
    limited.push(...mentions.limited);
  }

  return {
    summary: assembleSummary({ identityLines: base.identityLines, verified, calculated, limited, community }),
    hasFollowedEntities: base.hasFollowedEntities,
    hasSyncedFixtures: base.hasSyncedFixtures,
    disclosureLabel: base.disclosureLabel,
  };
}

async function buildBaseGrounding(profile: Profile, focus: GroundingFocus | null): Promise<BaseGrounding> {

  const supabase = createServerSupabaseClient();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: follows }, { data: favouriteTeam }, { data: todaysFixtures }] = await Promise.all([
    supabase
      .from("follows")
      .select("followed_type, followed_id")
      .eq("follower_profile_id", profile.id)
      .in("followed_type", ["team", "player", "competition"])
      .limit(20),
    profile.favourite_team_id
      ? supabase.from("teams").select("id, name").eq("id", profile.favourite_team_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("fixtures")
      .select("kickoff_at, status, home_score, away_score, home_team:teams!fixtures_home_team_id_fkey(name), away_team:teams!fixtures_away_team_id_fkey(name), competition:competitions(name)")
      .gte("kickoff_at", `${today}T00:00:00Z`)
      .lte("kickoff_at", `${today}T23:59:59Z`)
      .order("kickoff_at", { ascending: true })
      .limit(30),
  ]);

  // Resolve the polymorphic follows rows to real names. follows.followed_id
  // has no DB-level FK (see 0001_kivo_core_schema.sql's comment on the
  // `follows` table), so this is the same two-step "collect ids per type,
  // then batch-fetch each entity table" pattern already used by
  // src/app/(app)/profile/following/page.tsx for the same reason.
  const teamIds = (follows ?? []).filter((f) => f.followed_type === "team").map((f) => f.followed_id);
  const playerIds = (follows ?? []).filter((f) => f.followed_type === "player").map((f) => f.followed_id);
  const competitionIds = (follows ?? []).filter((f) => f.followed_type === "competition").map((f) => f.followed_id);

  const [{ data: followedTeams }, { data: followedPlayers }, { data: followedCompetitions }] = await Promise.all([
    teamIds.length
      ? supabase.from("teams").select("id, name").in("id", teamIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    playerIds.length
      ? supabase.from("players").select("id, full_name, known_as").in("id", playerIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string; known_as: string | null }[] }),
    competitionIds.length
      ? supabase.from("competitions").select("name").in("id", competitionIds)
      : Promise.resolve({ data: [] as { name: string }[] }),
  ]);

  // KIVO Form Engine (src/lib/football/form-engine.ts): the user's favourite
  // team's real recent form, when there is one and enough synced matches
  // exist to compute it honestly. Scoped to just the favourite team (not
  // every followed team) to keep this one extra query bounded regardless of
  // how many entities the user follows. Also captures the id of that team's
  // single most recent finished fixture (recentFixtures is already ordered
  // newest-first) so Match Intelligence below can ground it without a
  // second "find the latest match" query.
  let favouriteTeamMostRecentFixtureId: string | null = null;
  const favouriteTeamForm = favouriteTeam
    ? await (async () => {
        const { data: recentFixtures } = await supabase
          .from("fixtures")
          .select("id, kickoff_at, status, home_score, away_score, home_team_id, away_team_id")
          .or(`home_team_id.eq.${favouriteTeam.id},away_team_id.eq.${favouriteTeam.id}`)
          .eq("status", "finished")
          .order("kickoff_at", { ascending: false })
          .limit(10);
        favouriteTeamMostRecentFixtureId = recentFixtures?.[0]?.id ?? null;
        const resolved: ResolvedResult[] = (recentFixtures ?? [])
          .map((f) => resolveFixtureResult(f, favouriteTeam.id))
          .filter((r): r is ResolvedResult => r !== null);
        return computeTeamForm(resolved, "last5");
      })()
    : null;

  // KIVO Match Intelligence (src/lib/football/match-intelligence.ts): real
  // H2H + both sides' form + real goal-timing for the favourite team's most
  // recent finished match — this is what lets the Copilot answer something
  // like "why did Arsenal lose" from one coherent, real object instead of
  // guessing. Bounded to one fixture (not one per followed team) for the
  // same reason favouriteTeamForm above is scoped narrowly. null whenever
  // there's no favourite team or it has no finished match synced yet.
  const matchInsights: MatchInsights | null = favouriteTeamMostRecentFixtureId
    ? await buildMatchInsights(supabase, favouriteTeamMostRecentFixtureId)
    : null;

  // RECOMMENDATIONS.md item 227: the same real form computation above,
  // extended from "favourite team only" to every followed team (capped —
  // see MAX_FOLLOWED_TEAMS_FOR_FORM) and to followed players' recent
  // involvement, reusing players/[id]/page.tsx's lineups→
  // resolveFixtureResult→computePlayerForm pattern for the latter.
  const otherFollowedTeams = (followedTeams ?? [])
    .filter((t) => t.id !== profile.favourite_team_id)
    .slice(0, MAX_FOLLOWED_TEAMS_FOR_FORM);
  const followedTeamForms = await Promise.all(
    otherFollowedTeams.map(async (team) => {
      const { data: recentFixtures } = await supabase
        .from("fixtures")
        .select("id, kickoff_at, status, home_score, away_score, home_team_id, away_team_id")
        .or(`home_team_id.eq.${team.id},away_team_id.eq.${team.id}`)
        .eq("status", "finished")
        .order("kickoff_at", { ascending: false })
        .limit(10);
      const resolved: ResolvedResult[] = (recentFixtures ?? [])
        .map((f) => resolveFixtureResult(f, team.id))
        .filter((r): r is ResolvedResult => r !== null);
      return { team, form: computeTeamForm(resolved, "last5") };
    }),
  );

  const followedPlayersForForm = (followedPlayers ?? []).slice(0, MAX_FOLLOWED_PLAYERS_FOR_FORM);
  const followedPlayerForms = await Promise.all(
    followedPlayersForForm.map(async (player) => {
      const { data: lineupRows } = await supabase
        .from("lineups")
        .select("team_id, fixture:fixtures(id, status, kickoff_at, home_team_id, away_team_id, home_score, away_score)")
        .eq("player_id", player.id);
      const resolved: ResolvedResult[] = (lineupRows ?? [])
        .flatMap((row) => {
          if (!row.fixture) return [];
          const r = resolveFixtureResult(row.fixture, row.team_id);
          return r ? [r] : [];
        })
        .sort((a, b) => new Date(b.kickoffAt).getTime() - new Date(a.kickoffAt).getTime());
      return { player, form: computePlayerForm(resolved, "last5") };
    }),
  );

  // RECOMMENDATIONS.md items 184/185: the real, entity-scoped data behind
  // "Ask AI about this match/team/player" (src/components/ai/ask-ai-link.tsx
  // on Match Centre / team pages / player pages). Fetched independently of
  // the favourite-team block above — a focused fixture/team/player is not
  // necessarily the user's favourite, and unlike that block this one names
  // both sides symmetrically rather than framing everything around "own"
  // team. Silently produces no lines (not an error) for an id that doesn't
  // resolve — a stale/deleted deep link just falls back to the rest of the
  // context rather than breaking the turn.
  const focusResult = focus ? await buildFocusFacts(supabase, focus) : null;

  const identityLines: string[] = [];
  identityLines.push(`User: @${profile.username}${favouriteTeam ? `, favourite team: ${favouriteTeam.name}` : ""}.`);
  if (focusResult?.label) {
    identityLines.push(
      `The user opened the AI Copilot directly from ${focusResult.label}'s page — if their question is generic ("tell me about this", "what's going on"), prioritize the real data about ${focusResult.label} below over anything else in this context.`,
    );
  }

  const verified: string[] = [];
  const calculated: string[] = [];
  const limited: string[] = [];
  const community: string[] = [];

  if (focusResult) {
    verified.push(...focusResult.facts.verified);
    calculated.push(...focusResult.facts.calculated);
    limited.push(...focusResult.facts.limited);
    // KIVO_NEXT_GEN KN-109: only a focused fixture ever produces these — a
    // Room belongs to one match, and there is no such thing as the Room for
    // "the teams you follow".
    community.push(...focusResult.facts.community);
  }

  if (favouriteTeam && favouriteTeamForm) {
    if (favouriteTeamForm.isSufficientSample) {
      verified.push(
        `${favouriteTeam.name}'s real recent form (last ${favouriteTeamForm.sampleSize} synced matches, newest first): ` +
          `${favouriteTeamForm.sequence.join(" ")} (${favouriteTeamForm.wins}W ${favouriteTeamForm.draws}D ${favouriteTeamForm.losses}L, ` +
          `${favouriteTeamForm.goalsScored} scored / ${favouriteTeamForm.goalsConceded} conceded).`,
      );
    } else {
      limited.push(
        `${favouriteTeam.name} has too few finished matches synced (${favouriteTeamForm.sampleSize}) for a reliable form trend — say so rather than guessing if asked about their form.`,
      );
    }
  }

  // KIVO Match Intelligence: real H2H, both sides' form, and real
  // goal-timing for the favourite team's most recent finished match — this
  // is the object that lets the Copilot answer "why did [team] win/lose"
  // from real evidence instead of speculation. Every sub-field degrades to
  // an honest "not enough data" sentence rather than a fabricated stat.
  if (favouriteTeam && matchInsights) {
    const isHome = matchInsights.homeTeam.id === favouriteTeam.id;
    const own = isHome ? matchInsights.homeTeam : matchInsights.awayTeam;
    const opp = isHome ? matchInsights.awayTeam : matchInsights.homeTeam;
    const ownGoalTiming = isHome ? matchInsights.homeGoalTiming : matchInsights.awayGoalTiming;

    verified.push(
      `${favouriteTeam.name}'s most recent finished match (kickoff ${matchInsights.kickoffAt}) was vs ${opp.name}. ` +
        `Use this specific match as the real evidence if the user asks something like "why did ${own.name} win/lose" — do not speculate beyond what's listed below.`,
    );

    if (matchInsights.headToHead && matchInsights.headToHead.meetings.length > 0) {
      const h2h = matchInsights.headToHead;
      const ownWins = isHome ? h2h.teamAWins : h2h.teamBWins;
      const oppWins = isHome ? h2h.teamBWins : h2h.teamAWins;
      calculated.push(
        `Real head-to-head history vs ${opp.name} (${h2h.meetings.length} prior synced meetings, excluding the match above): ` +
          `${own.name} ${ownWins}W ${h2h.draws}D ${oppWins}L.`,
      );
    } else {
      verified.push(`No prior head-to-head meetings between ${own.name} and ${opp.name} are synced yet.`);
    }

    if (ownGoalTiming.isSufficientSample) {
      calculated.push(
        `${own.name}'s real goal-timing split: ${ownGoalTiming.goalsAfter70} of ${ownGoalTiming.goalsScored} goals scored after the 70th minute ` +
          `(based on ${ownGoalTiming.finishedMatchesSample} finished matches synced).`,
      );
    } else {
      limited.push(`${own.name} has too few finished matches synced for a reliable goal-timing split — say so if asked.`);
    }
  }

  // A followed row whose target was since deleted resolves to nothing here
  // (same caveat as the following page) and is simply dropped rather than
  // listed as a broken reference.
  const followedNames = [
    ...(followedTeams ?? []).map((t) => `${t.name} (team)`),
    ...(followedPlayers ?? []).map((p) => `${p.known_as ?? p.full_name} (player)`),
    ...(followedCompetitions ?? []).map((c) => `${c.name} (competition)`),
  ];

  if (followedNames.length > 0) {
    verified.push(`Follows: ${followedNames.join(", ")}.`);
  } else {
    verified.push("Has not followed any teams, players or competitions yet.");
  }

  // Item 227: real recent form for followed teams and players beyond the
  // favourite team, same honest "too few matches" fallback as above.
  for (const { team, form } of followedTeamForms) {
    if (form.isSufficientSample) {
      calculated.push(
        `${team.name}'s (followed) real recent form (last ${form.sampleSize} synced matches, newest first): ` +
          `${form.sequence.join(" ")} (${form.wins}W ${form.draws}D ${form.losses}L).`,
      );
    } else {
      limited.push(`${team.name} (followed) has too few finished matches synced (${form.sampleSize}) for a reliable form trend.`);
    }
  }
  for (const { player, form } of followedPlayerForms) {
    const displayName = player.known_as ?? player.full_name;
    if (form.isSufficientSample) {
      calculated.push(
        `${displayName}'s (followed player) team result in their last ${form.sampleSize} synced appearances: ` +
          `${form.sequence.join(" ")} (${form.wins}W ${form.draws}D ${form.losses}L).`,
      );
    } else {
      limited.push(`${displayName} (followed player) has too few synced appearances for a reliable recent-form trend.`);
    }
  }

  if (todaysFixtures && todaysFixtures.length > 0) {
    verified.push(`Today's synced fixtures (${todaysFixtures.length}):`);
    for (const f of todaysFixtures.slice(0, 15)) {
      const home = f.home_team?.name ?? "Unknown";
      const away = f.away_team?.name ?? "Unknown";
      const comp = f.competition?.name ?? "Unknown competition";
      const score = f.home_score != null && f.away_score != null ? ` (${f.home_score}-${f.away_score})` : "";
      verified.push(`- ${home} vs ${away}${score} — ${comp}, status: ${f.status}`);
    }
  } else {
    verified.push(
      "No fixtures are synced into KIVO's database yet. The football data provider integration exists but no sync has populated real matches. Do not invent fixtures, scores, or standings.",
    );
  }

  // RECOMMENDATIONS.md items 188/300: the three labelled sections below are
  // what let the model tag its own claims — see SYSTEM_PROMPT in
  // /api/ai/chat/route.ts for the exact tagging instruction, and
  // src/components/ai/chat.tsx for how the tags render as chips. A line
  // landing in the wrong bucket would just mislabel a chip, never fabricate
  // data — the underlying facts are identical to what this file always
  // computed. KIVO-LIMITED (item 300) makes the existing isSufficientSample
  // uncertainty sentences a structural third bucket instead of prose folded
  // into KIVO-CALCULATED that the model may or may not have visibly surfaced.
  return {
    identityLines,
    verified,
    calculated,
    limited,
    community,
    hasFollowedEntities: followedNames.length > 0,
    hasSyncedFixtures: !!todaysFixtures && todaysFixtures.length > 0,
    disclosureLabel: focusResult?.label ?? null,
    // Every team this context already talks about by name: the favourite, and
    // every followed team whose form was computed above.
    describedTeamIds: [
      ...(profile.favourite_team_id ? [profile.favourite_team_id] : []),
      ...(followedTeams ?? []).map((t) => t.id),
    ],
  };
}

/**
 * KIVO_NEXT_GEN KN-109: real Match Room posts as grounding for a focused fixture.
 *
 * This is the one capability in this file that needs no football provider at
 * all, and the one no scores app can copy: a Room during a live match is dense,
 * first-party, human text about that exact match, and KIVO owns all of it.
 * "What are people in this Room actually saying" is a real question the Copilot
 * can now answer from real rows.
 *
 * It is also the only input to the whole grounding context that is **opinion**,
 * which drives every decision here:
 *
 *  - It lands in its own `community` bucket, never in `verified`. Provenance in
 *    this product is structural rather than a matter of the model's judgment —
 *    if opinion shared a bucket with facts, "KIVO users think that was a foul"
 *    and "the referee gave a penalty" would reach the reader tagged identically.
 *  - Each post carries its author's `@username`, so the model can attribute
 *    anything it quotes rather than laundering one person's opinion into "fans
 *    are saying". Names come from `get_public_profiles`, the same narrow RPC the
 *    feed uses — `profiles_select_own_or_admin` blocks reading another user's
 *    row directly, and this deliberately does not work around that.
 *  - System posts are excluded. KIVO's own automatic goal/red-card
 *    announcements (`posts.is_system`, migration 0047) are verified facts that
 *    already appear in the VERIFIED section; letting them through here would
 *    label KIVO's own record of a goal as somebody's opinion.
 *  - It reads through the caller's session-scoped client, so
 *    `posts_select_public`'s moderation filter (migration 0045) applies exactly
 *    as it does on screen. A shadow-muted author's posts are invisible to this
 *    viewer in the Room and are equally invisible to the model — the moderation
 *    control cannot be bypassed by asking the Copilot about the match.
 *  - Bodies are truncated, so the model has to characterise a Room rather than
 *    paste it back.
 *
 * Returns an empty array for a Room with nothing in it, which renders as an
 * honest "no Match Room posts are in context" line rather than an invitation to
 * imagine some.
 */
async function buildRoomCommunityFacts(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  fixtureId: string,
  label: string,
): Promise<string[]> {
  const { data: posts } = await supabase
    .from("posts")
    .select("id, body, created_at, author_profile_id")
    .eq("fixture_id", fixtureId)
    .eq("is_system", false)
    .order("created_at", { ascending: false })
    .limit(MAX_ROOM_POSTS_FOR_CONTEXT);

  if (!posts || posts.length === 0) return [];

  const authorIds = [...new Set(posts.map((p) => p.author_profile_id))];
  const { data: authors } = await supabase.rpc("get_public_profiles", { p_ids: authorIds });
  const usernameById = new Map((authors ?? []).map((a) => [a.id, a.username]));

  const lines = [
    `${posts.length} real post${posts.length === 1 ? "" : "s"} from KIVO users in the Match Room for ${label}, newest first. These are opinions, not facts:`,
  ];
  for (const post of posts) {
    const username = usernameById.get(post.author_profile_id);
    const body = post.body.replace(/\s+/g, " ").trim();
    const truncated = body.length > MAX_ROOM_POST_CHARS ? `${body.slice(0, MAX_ROOM_POST_CHARS)}…` : body;
    lines.push(`- @${username ?? "a KIVO user"}: ${truncated}`);
  }
  return lines;
}

/**
 * RECOMMENDATIONS.md items 184/185: real, entity-scoped facts for whichever
 * fixture/team/player the user deep-linked in from. Reuses the exact same
 * engines (`buildMatchInsights`, `computeTeamForm`, `computePlayerForm`) the
 * rest of this file already calls — nothing new is computed, only which
 * entity it's computed for changes.
 */
async function buildFocusFacts(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  focus: GroundingFocus,
): Promise<{ label: string; facts: FactLines } | null> {
  if (focus.type === "fixture") {
    const { data: fixture } = await supabase
      .from("fixtures")
      .select(
        "id, kickoff_at, status, home_score, away_score, home_team:teams!fixtures_home_team_id_fkey(id, name), away_team:teams!fixtures_away_team_id_fkey(id, name), competition:competitions(name)",
      )
      .eq("id", focus.id)
      .maybeSingle();
    if (!fixture || !fixture.home_team || !fixture.away_team) return null;

    const label = `${fixture.home_team.name} vs ${fixture.away_team.name}`;
    const facts = emptyFacts();
    const score = fixture.home_score != null && fixture.away_score != null ? ` (${fixture.home_score}-${fixture.away_score})` : "";
    facts.verified.push(
      `Focused match: ${label}${score} — ${fixture.competition?.name ?? "Unknown competition"}, kickoff ${fixture.kickoff_at}, status: ${fixture.status}.`,
    );

    const insights = await buildMatchInsights(supabase, fixture.id);
    if (insights) {
      if (insights.headToHead && insights.headToHead.meetings.length > 0) {
        const h2h = insights.headToHead;
        facts.calculated.push(
          `Real head-to-head between ${fixture.home_team.name} and ${fixture.away_team.name} (${h2h.meetings.length} prior synced meetings): ` +
            `${fixture.home_team.name} ${h2h.teamAWins}W, ${h2h.draws}D, ${fixture.away_team.name} ${h2h.teamBWins}W.`,
        );
      } else {
        facts.verified.push(`No prior head-to-head meetings between ${fixture.home_team.name} and ${fixture.away_team.name} are synced yet.`);
      }
      for (const [team, form] of [
        [fixture.home_team, insights.homeForm],
        [fixture.away_team, insights.awayForm],
      ] as const) {
        if (form.isSufficientSample) {
          facts.calculated.push(
            `${team.name}'s real recent form (last ${form.sampleSize} synced matches): ${form.sequence.join(" ")} ` +
              `(${form.wins}W ${form.draws}D ${form.losses}L).`,
          );
        } else {
          facts.limited.push(`${team.name} has too few finished matches synced (${form.sampleSize}) for a reliable form trend.`);
        }
      }
    }

    // KIVO_NEXT_GEN KN-109: what people in this match's Room are actually
    // saying. See buildRoomCommunityFacts for the rules this is read under.
    facts.community.push(...(await buildRoomCommunityFacts(supabase, fixture.id, label)));

    return { label, facts };
  }

  if (focus.type === "team") {
    const { data: team } = await supabase.from("teams").select("id, name").eq("id", focus.id).maybeSingle();
    if (!team) return null;

    const { data: recentFixtures } = await supabase
      .from("fixtures")
      .select("id, kickoff_at, status, home_score, away_score, home_team_id, away_team_id")
      .or(`home_team_id.eq.${team.id},away_team_id.eq.${team.id}`)
      .eq("status", "finished")
      .order("kickoff_at", { ascending: false })
      .limit(10);
    const resolved: ResolvedResult[] = (recentFixtures ?? [])
      .map((f) => resolveFixtureResult(f, team.id))
      .filter((r): r is ResolvedResult => r !== null);
    const form = computeTeamForm(resolved, "last5");

    const facts = emptyFacts();
    facts.verified.push(`Focused team: ${team.name}.`);
    if (form.isSufficientSample) {
      facts.calculated.push(
        `${team.name}'s real recent form (last ${form.sampleSize} synced matches, newest first): ` +
          `${form.sequence.join(" ")} (${form.wins}W ${form.draws}D ${form.losses}L, ${form.goalsScored} scored / ${form.goalsConceded} conceded).`,
      );
    } else {
      facts.limited.push(`${team.name} has too few finished matches synced (${form.sampleSize}) for a reliable form trend.`);
    }

    return { label: team.name, facts };
  }

  // focus.type === "player"
  const { data: player } = await supabase.from("players").select("id, full_name, known_as").eq("id", focus.id).maybeSingle();
  if (!player) return null;
  const displayName = player.known_as ?? player.full_name;

  const { data: lineupRows } = await supabase
    .from("lineups")
    .select("team_id, fixture:fixtures(id, status, kickoff_at, home_team_id, away_team_id, home_score, away_score)")
    .eq("player_id", player.id);
  const resolved: ResolvedResult[] = (lineupRows ?? [])
    .flatMap((row) => {
      if (!row.fixture) return [];
      const r = resolveFixtureResult(row.fixture, row.team_id);
      return r ? [r] : [];
    })
    .sort((a, b) => new Date(b.kickoffAt).getTime() - new Date(a.kickoffAt).getTime());
  const form = computePlayerForm(resolved, "last5");

  const facts = emptyFacts();
  facts.verified.push(`Focused player: ${displayName}.`);
  if (form.isSufficientSample) {
    facts.calculated.push(
      `${displayName}'s team result in their last ${form.sampleSize} synced appearances: ${form.sequence.join(" ")} ` +
        `(${form.wins}W ${form.draws}D ${form.losses}L).`,
    );
  } else {
    facts.limited.push(`${displayName} has too few synced appearances for a reliable recent-form trend.`);
  }

  return { label: displayName, facts };
}
