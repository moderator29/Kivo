import type { Metadata } from "next";
import Link from "next/link";
import { GitCompareArrows } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { QueryFailedError, readList, readRow } from "@/lib/query-result";
import { FadeIn } from "@/components/ui/fade-in";
import { ShareCardPanel } from "@/components/share/share-card-panel";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import { PlayerComparePicker, type ComparePlayerOption } from "@/components/players/player-compare-picker";
import { computePlayerMatchStats, type PlayerMatchStats } from "@/lib/football/player-stats";

export const metadata: Metadata = { title: "Compare players" };

type Supabase = ReturnType<typeof createServerSupabaseClient>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PlayerCompareData = {
  id: string;
  name: string;
  photoUrl: string | null;
  position: string | null;
  teamName: string | null;
  teamCrestUrl: string | null;
  stats: PlayerMatchStats;
};

async function getPlayerCompareData(supabase: Supabase, id: string): Promise<PlayerCompareData | null> {
  const [playerResult, lineupsResult, eventsResult, assistEventsResult] = await Promise.all([
    supabase
      .from("players")
      .select("id, full_name, known_as, position, photo_url, current_team:teams(name, crest_url)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("lineups").select("is_starting, fixture:fixtures(status)").eq("player_id", id),
    supabase.from("fixture_events").select("event_type").eq("player_id", id),
    // The assister is `related_player_id` on the goal event itself — the same
    // field fantasy scoring awards from, and counted over the same
    // `fixture_events` rows as the goals above so both columns span one set of
    // matches. See computePlayerMatchStats.
    supabase.from("fixture_events").select("event_type").eq("related_player_id", id),
  ]);

  // `readRow` rather than a destructure: the caller turns `null` into "no such
  // player", and a failed lookup is a fact about the request, not about
  // whether the player exists.
  const player = readRow(playerResult, "playersCompare.player");
  if (!player) return null;

  // The three stat reads throw rather than degrade, and on this page in
  // particular that is the only honest option. A comparison is a claim about
  // two things *relative to each other*: a failed read on one side renders it
  // with zero appearances, zero goals and zero assists beside a real record,
  // which does not read as missing data — it reads as a verdict. There is no
  // version of a half-loaded comparison that is better than none.
  const lineups = readList(lineupsResult, "playersCompare.lineups");
  const events = readList(eventsResult, "playersCompare.events");
  const assists = readList(assistEventsResult, "playersCompare.assists");
  if (lineups.failed || events.failed || assists.failed) {
    throw new QueryFailedError(
      "playersCompare.stats",
      "could not read one player's record, and half a comparison reads as a verdict",
    );
  }

  return {
    id: player.id,
    name: player.known_as ?? player.full_name,
    photoUrl: player.photo_url,
    position: player.position,
    teamName: player.current_team?.name ?? null,
    teamCrestUrl: player.current_team?.crest_url ?? null,
    stats: computePlayerMatchStats(lineups.rows, events.rows, assists.rows),
  };
}

/** Minimal display info for the picker's pre-filled slot on a `?a=<id>`
 * deep link (from a player page's "Compare with another player") — just
 * enough for `PlayerSlot`'s selected-chip view, not the full stat fetch
 * `getPlayerCompareData` does. */
async function getPlayerOption(supabase: Supabase, id: string): Promise<ComparePlayerOption | null> {
  const { data: player } = await supabase
    .from("players")
    .select("id, full_name, known_as, photo_url, current_team:teams(name)")
    .eq("id", id)
    .maybeSingle();
  if (!player) return null;
  return {
    id: player.id,
    name: player.known_as ?? player.full_name,
    teamName: player.current_team?.name ?? null,
    photoUrl: player.photo_url,
  };
}

function StatRow({ label, a, b }: { label: string; a: number; b: number }) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-2.5">
      <span className={`text-right text-sm font-semibold tabular-nums ${a >= b ? "text-foreground" : "text-foreground-subtle"}`}>
        {a}
      </span>
      <span className="text-center text-[11px] uppercase tracking-wide text-foreground-subtle">{label}</span>
      <span className={`text-left text-sm font-semibold tabular-nums ${b >= a ? "text-foreground" : "text-foreground-subtle"}`}>
        {b}
      </span>
    </div>
  );
}

function PlayerHeader({ player }: { player: PlayerCompareData }) {
  return (
    <Link
      href={`/players/${player.id}`}
      className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center transition hover:opacity-90"
    >
      <PlayerAvatar photoUrl={player.photoUrl} name={player.name} size={48} />
      <span className="max-w-full truncate text-sm font-semibold text-foreground">{player.name}</span>
      <span className="max-w-full truncate text-[11px] text-foreground-subtle">
        {[player.position, player.teamName].filter(Boolean).join(" · ") || "-"}
      </span>
    </Link>
  );
}

export default async function PlayerComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { a, b } = await searchParams;
  const supabase = createServerSupabaseClient();

  const validA = a && UUID_RE.test(a) ? a : undefined;
  const validB = b && UUID_RE.test(b) ? b : undefined;
  const hasSelection = Boolean(validA) && Boolean(validB);
  const validSelection = hasSelection && validA !== validB;

  const [initialA, initialB] = await Promise.all([
    validA ? getPlayerOption(supabase, validA) : Promise.resolve(null),
    validB ? getPlayerOption(supabase, validB) : Promise.resolve(null),
  ]);

  let playerA: PlayerCompareData | null = null;
  let playerB: PlayerCompareData | null = null;
  if (validSelection && validA && validB) {
    [playerA, playerB] = await Promise.all([
      getPlayerCompareData(supabase, validA),
      getPlayerCompareData(supabase, validB),
    ]);
  }

  const notFoundSelection = validSelection && (!playerA || !playerB);

  return (
    <div className="kivo-page">
      <FadeIn>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
          <GitCompareArrows className="h-5 w-5 text-accent" strokeWidth={1.75} />
          Compare players
        </h1>
        <p className="text-sm text-foreground-muted">
          Appearances, starts, goals and cards from real matches. No AI, no guesswork.
        </p>
      </FadeIn>

      <FadeIn delay={0.08}>
        <PlayerComparePicker initialA={initialA} initialB={initialB} />
      </FadeIn>

      {hasSelection && !validSelection && (
        <FadeIn delay={0.14} className="kivo-glass rounded-2xl p-6 text-center text-sm text-foreground-muted">
          Choose two different players to compare.
        </FadeIn>
      )}

      {notFoundSelection && (
        <FadeIn delay={0.14} className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-8 text-center">
          <p className="text-sm text-foreground-muted">
            One of the selected players couldn&apos;t be found. It may have been removed, or the link is incorrect.
          </p>
          <Link href="/players" className="text-xs font-medium text-accent hover:text-accent/80">
            Browse players
          </Link>
        </FadeIn>
      )}

      {playerA && playerB && (
        <FadeIn delay={0.14} className="kivo-glass flex flex-col gap-4 rounded-2xl p-6">
          <div className="flex items-start justify-between gap-3">
            <PlayerHeader player={playerA} />
            <PlayerHeader player={playerB} />
          </div>

          <div className="flex flex-col divide-y divide-hairline-soft border-t border-hairline-soft">
            <StatRow label="Appearances" a={playerA.stats.appearances} b={playerB.stats.appearances} />
            <StatRow label="Starts" a={playerA.stats.starts} b={playerB.stats.starts} />
            <StatRow label="Goals" a={playerA.stats.goals} b={playerB.stats.goals} />
            {/* Both sides or neither: a row with one blank column invites the
                reader to read the blank as a zero. */}
            {playerA.stats.assists !== null && playerB.stats.assists !== null && (
              <StatRow label="Assists" a={playerA.stats.assists} b={playerB.stats.assists} />
            )}
            <StatRow label="Yellow cards" a={playerA.stats.yellowCards} b={playerB.stats.yellowCards} />
            <StatRow label="Red cards" a={playerA.stats.redCards} b={playerB.stats.redCards} />
          </div>

          <p className="text-center text-[11px] text-foreground-subtle">
            From {playerA.stats.appearances} match{playerA.stats.appearances === 1 ? "" : "es"} on KIVO
            for {playerA.name}, and {playerB.stats.appearances} for {playerB.name}. Sync coverage is
            admin-triggered and partial, not a full season record.
          </p>

          {/* Only rows where both players have a real number make it onto the
              card, so a comparison with nothing in common produces no card. */}
          <ShareCardPanel
            kind="player-comparison"
            id={playerA.id}
            secondaryId={playerB.id}
            shareUrl={`/players/compare?a=${playerA.id}&b=${playerB.id}`}
            shareText={`${playerA.name} vs ${playerB.name} on KIVO.`}
            heading="Share this comparison"
            description="Pick a background. The preview is the exact image you save."
          />
        </FadeIn>
      )}

      {!hasSelection && (
        <FadeIn delay={0.14} className="kivo-glass rounded-2xl p-6 text-center text-sm text-foreground-muted">
          Pick two players above to see how they stack up.
        </FadeIn>
      )}
    </div>
  );
}
