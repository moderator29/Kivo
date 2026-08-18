import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { computeTeamForm, resolveFixtureResult, type ResolvedResult } from "@/lib/football/form-engine";
import { extractMentionPhrases } from "./mention-phrases";

/**
 * KIVO_NEXT_GEN KN-108: resolve the football entities a user actually named,
 * whether or not they follow them.
 *
 * The problem this fixes is not a missing feature, it is a false statement.
 * `buildGroundingContext` assembles everything the Copilot knows from the
 * viewer's own follows plus today's fixtures. Ask it about a club KIVO has
 * genuinely synced but you happen not to follow, and the grounding contains
 * nothing about that club — so the model, correctly obeying its instruction not
 * to answer from outside the context, says KIVO doesn't have it. KIVO does have
 * it. On a platform whose first rule is never asserting anything it has not
 * verified, asserting a gap that isn't there is the same class of error as
 * asserting a stat that isn't there.
 *
 * `RECOMMENDATIONS.md` item 186 scopes the full tool-use loop for this and is
 * rightly sized as Large. This is deliberately the small, complementary half:
 * one deterministic retrieval step, before the model runs, with no tool loop,
 * no change to the streaming contract, and a per-turn cost that is bounded by
 * construction rather than by whatever the model decides to ask for. The model
 * never chooses what gets looked up, which is also why this cannot be talked
 * into retrieving something.
 */

type Client = SupabaseClient<Database>;

/** How many resolved entities are described at all. The RPC already ranks by
 * similarity, so this keeps the strongest matches and drops the tail. */
const MAX_RESOLVED_ENTITIES = 6;

/** How many resolved *teams* additionally get real form computed. Each costs
 * one bounded fixtures query, so this is the knob that decides the per-turn
 * price of the whole feature. */
const MAX_TEAMS_ENRICHED = 3;

/** Recent finished matches read per enriched team — the same window
 * `grounding.ts` already uses for a followed team's form. */
const FORM_FIXTURE_WINDOW = 10;

/** Trigram similarity below this is not a mention. See migration 0067 for why
 * the threshold is stricter than pg_trgm's own default. */
const MIN_SIMILARITY = 0.4;

export interface MentionFacts {
  verified: string[];
  calculated: string[];
  limited: string[];
  /** Human labels of what was resolved, for logging/diagnostics — never shown
   * to the user as a claim on its own. */
  labels: string[];
}

function emptyMentionFacts(): MentionFacts {
  return { verified: [], calculated: [], limited: [], labels: [] };
}

/**
 * Real facts about the entities named in one user message.
 *
 * `excludeTeamIds` is the set the base grounding already describes (the
 * viewer's follows and favourite team). Re-describing those would spend queries
 * to tell the model something it has already been told, and would put the same
 * club in the context twice under slightly different wording — which is exactly
 * how a model ends up contradicting itself.
 */
export async function buildMentionFacts(
  supabase: Client,
  message: string,
  excludeTeamIds: Set<string> = new Set(),
): Promise<MentionFacts> {
  const phrases = extractMentionPhrases(message);
  if (phrases.length === 0) return emptyMentionFacts();

  const { data: matches, error } = await supabase.rpc("resolve_football_entities", {
    p_phrases: phrases,
    p_limit: MAX_RESOLVED_ENTITIES,
    p_min_similarity: MIN_SIMILARITY,
  });

  // A failed resolution degrades to "no extra context", never to a guess. The
  // turn still runs on the base grounding, which is exactly what happened
  // before this existed.
  if (error || !matches || matches.length === 0) return emptyMentionFacts();

  const facts = emptyMentionFacts();
  const teams = matches.filter((m) => m.entity_type === "team" && !excludeTeamIds.has(m.entity_id));
  const players = matches.filter((m) => m.entity_type === "player");
  const competitions = matches.filter((m) => m.entity_type === "competition");

  for (const match of matches) facts.labels.push(`${match.entity_type}:${match.label}`);

  // ── Teams ───────────────────────────────────────────────────────────────
  const enriched = teams.slice(0, MAX_TEAMS_ENRICHED);
  const teamForms = await Promise.all(
    enriched.map(async (team) => {
      const { data: recentFixtures } = await supabase
        .from("fixtures")
        .select("id, kickoff_at, status, home_score, away_score, home_team_id, away_team_id")
        .in("status", ["finished"])
        .or(`home_team_id.eq.${team.entity_id},away_team_id.eq.${team.entity_id}`)
        .order("kickoff_at", { ascending: false })
        .limit(FORM_FIXTURE_WINDOW);
      const resolved: ResolvedResult[] = (recentFixtures ?? [])
        .map((f) => resolveFixtureResult(f, team.entity_id))
        .filter((r): r is ResolvedResult => r !== null);
      return { team, form: computeTeamForm(resolved, "last5") };
    }),
  );

  for (const { team, form } of teamForms) {
    facts.verified.push(
      `${team.label} is a real team in KIVO's database${team.sublabel ? ` (${team.sublabel})` : ""}, mentioned in the user's message.`,
    );
    if (form.isSufficientSample) {
      facts.calculated.push(
        `${team.label}'s real recent form (last ${form.sampleSize} synced matches, newest first): ` +
          `${form.sequence.join(" ")} (${form.wins}W ${form.draws}D ${form.losses}L, ` +
          `${form.goalsScored} scored / ${form.goalsConceded} conceded).`,
      );
    } else {
      facts.limited.push(
        `${team.label} has too few finished matches synced (${form.sampleSize}) for a reliable form trend — say so rather than guessing if asked.`,
      );
    }
  }

  // Teams beyond the enrichment cap are still named, so the model knows KIVO
  // has them rather than denying they exist — it just has no form to cite.
  for (const team of teams.slice(MAX_TEAMS_ENRICHED)) {
    facts.verified.push(
      `${team.label} is a real team in KIVO's database${team.sublabel ? ` (${team.sublabel})` : ""}, but no recent-form data was computed for it in this turn.`,
    );
  }

  // ── Players ─────────────────────────────────────────────────────────────
  if (players.length > 0) {
    const { data: playerRows } = await supabase
      .from("players")
      .select("id, full_name, known_as, position, nationality, current_team:teams(name)")
      .in(
        "id",
        players.map((p) => p.entity_id),
      );
    for (const player of playerRows ?? []) {
      const name = player.known_as || player.full_name;
      const parts = [
        player.position ? `position ${player.position}` : null,
        player.nationality ? `nationality ${player.nationality}` : null,
        player.current_team?.name ? `currently at ${player.current_team.name}` : null,
      ].filter(Boolean);
      facts.verified.push(
        `${name} is a real player in KIVO's database${parts.length ? ` (${parts.join(", ")})` : ""}, mentioned in the user's message.`,
      );
    }
  }

  // ── Competitions ────────────────────────────────────────────────────────
  if (competitions.length > 0) {
    const { data: seasonRows } = await supabase
      .from("seasons")
      .select("competition_id, name")
      .in(
        "competition_id",
        competitions.map((c) => c.entity_id),
      )
      .eq("is_current", true);
    const seasonByCompetition = new Map((seasonRows ?? []).map((s) => [s.competition_id, s.name]));
    for (const competition of competitions) {
      const season = seasonByCompetition.get(competition.entity_id);
      facts.verified.push(
        `${competition.label} is a real competition in KIVO's database${competition.sublabel ? ` (${competition.sublabel})` : ""}` +
          `${season ? `, current season ${season}` : ", with no current season synced yet"}.`,
      );
    }
  }

  return facts;
}
