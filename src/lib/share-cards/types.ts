/**
 * KIVO share cards — the shared vocabulary.
 *
 * The original directive names ten shareable card types. The match card
 * (`src/lib/football/match-share-card.ts`) shipped first and is deliberately
 * left alone: it composites real fixture data onto a bespoke piece of KIVO
 * artwork with hand-measured hit boxes, and it is the only card that works
 * that way. The other nine live here and share one system instead of nine
 * bespoke ones:
 *
 *   - one canvas size,
 *   - one background picker (the same ten KIVO backgrounds a profile cover
 *     uses, plus the viewer's own uploaded cover),
 *   - one `ShareSheet` (preview + Save/Copy/Share + background strip),
 *   - and one set of card renderers, drawn with inline styles only so the
 *     *same* React element renders both in the browser preview and inside
 *     `next/og`'s rasteriser. That is the point: a preview that drifts from
 *     the downloaded PNG is the standard failure mode of a share feature, and
 *     the only way to be sure it can't happen is to not have two renderers.
 *
 * ## The one rule these types encode
 *
 * Every number on a share card is a real number or the card omits that
 * element. A share card travels — it is seen by people who will never open
 * the app and have no way to sanity-check it — so a fabricated stat on one is
 * worse than a fabricated stat anywhere else in the product. Concretely that
 * means: no field here defaults to `0`, no field is "computed" from an
 * incomplete sample, optional facts are `| null` and every renderer drops the
 * whole element when it's null rather than printing a dash or a zero. A real
 * zero (a player who genuinely played and genuinely scored none) is different
 * from an absent one, and the builders in `build.ts` are where that
 * distinction is made.
 */

/** The nine card types built here. "match" is not in this union — it predates
 * this system and keeps its own artwork-composited route. */
export const SHARE_CARD_KINDS = [
  "live-score",
  "player-performance",
  "player-comparison",
  "prediction",
  "fantasy-performance",
  "league-table",
  "transfer",
  "ai-insight",
  "profile-achievement",
] as const;

export type ShareCardKind = (typeof SHARE_CARD_KINDS)[number];

export function isShareCardKind(value: string | null | undefined): value is ShareCardKind {
  return !!value && (SHARE_CARD_KINDS as readonly string[]).includes(value);
}

/**
 * Square, 1080px. Square because these are sent in WhatsApp and posted to X
 * and Instagram in roughly equal measure and it is the one ratio none of them
 * crops; 1080 because that is the largest edge any of those three actually
 * serves, so a bigger canvas would only cost bytes.
 */
export const SHARE_CARD_CANVAS = { width: 1080, height: 1080 } as const;

/** A label/value pair that made it onto a card because both halves are real. */
export type ShareStat = {
  label: string;
  value: string;
  /** Rendered in the accent colour rather than plain white — used sparingly,
   * for the one number the card is actually about. */
  emphasis?: boolean;
};

export type ShareTeamRef = {
  name: string;
  shortName: string | null;
  crestUrl: string | null;
};

export type SharePlayerRef = {
  name: string;
  photoUrl: string | null;
  teamName: string | null;
  position: string | null;
};

export type ShareScorer = {
  minute: number;
  addedTime: number | null;
  playerName: string;
  isOwnGoal: boolean;
  side: "home" | "away";
};

export type LiveScoreCard = {
  kind: "live-score";
  competitionName: string;
  /** "LIVE", "HALF TIME", "FULL TIME", "KICK-OFF" — never invented, derived
   * from the fixture's own status enum. */
  statusLabel: string;
  state: "upcoming" | "live" | "finished";
  /** Only ever set while the fixture is genuinely live and the provider gave
   * us a minute. A live match with no synced minute shows no minute. */
  minuteLabel: string | null;
  kickoffLabel: string;
  venueLabel: string | null;
  home: ShareTeamRef;
  away: ShareTeamRef;
  /** Null for a fixture that hasn't kicked off — not zero. */
  homeScore: number | null;
  awayScore: number | null;
  scorers: ShareScorer[];
};

export type PlayerPerformanceCard = {
  kind: "player-performance";
  player: SharePlayerRef;
  teamCrestUrl: string | null;
  /** What window the stats cover, in words, so the card can never imply a
   * span it doesn't have ("All synced matches" when there is no season
   * filter). */
  windowLabel: string;
  stats: ShareStat[];
};

export type PlayerComparisonCard = {
  kind: "player-comparison";
  left: SharePlayerRef;
  right: SharePlayerRef;
  windowLabel: string;
  /** Only rows where BOTH players have a real value — a comparison with one
   * side blank is not a comparison. */
  rows: { label: string; leftValue: string; rightValue: string; leader: "left" | "right" | "tie" }[];
};

export type PredictionCard = {
  kind: "prediction";
  displayName: string;
  username: string;
  avatarUrl: string | null;
  home: ShareTeamRef;
  away: ShareTeamRef;
  kickoffLabel: string;
  competitionName: string;
  predictedLabel: string;
  /** Set only once the fixture has finished and both scores are synced. */
  actualLabel: string | null;
  /** Set only once the prediction has actually been scored. `0` here is a
   * real awarded zero, not a placeholder. */
  pointsAwarded: number | null;
  outcome: "correct" | "missed" | "pending";
};

export type FantasyPerformanceCard = {
  kind: "fantasy-performance";
  teamName: string;
  managerName: string;
  gameweekLabel: string;
  points: number;
  /** Real league standing, only when the team is genuinely in a league that
   * has a computed leaderboard. */
  rankLabel: string | null;
  stats: ShareStat[];
};

export type LeagueTableCard = {
  kind: "league-table";
  competitionName: string;
  seasonLabel: string;
  rows: {
    position: number;
    team: ShareTeamRef;
    played: number;
    goalDifference: number;
    points: number;
  }[];
  /** When the card was made from a team page, that team's row is lit up. */
  highlightTeamName: string | null;
  /** Set when the table is a window onto a longer table rather than all of
   * it, so the card says so instead of implying a ten-team division. */
  truncatedNote: string | null;
};

export type TransferCard = {
  kind: "transfer";
  playerName: string;
  playerPhotoUrl: string | null;
  fromTeam: ShareTeamRef | null;
  toTeam: ShareTeamRef | null;
  typeLabel: string;
  /** The provider's own fee string, verbatim, or nothing. Never normalised
   * into a number KIVO would then be asserting. */
  feeText: string | null;
  dateLabel: string;
  /** Every synced transfer is a completed, recorded move. See
   * `src/lib/football/transfer-labels.ts` and RECOMMENDATIONS.md item 178 for
   * why there is exactly one status and not four. */
  statusLabel: string;
  sourceLabel: string;
};

export type AiInsightCard = {
  kind: "ai-insight";
  question: string;
  answer: string;
  askedAtLabel: string;
  /** What the answer was grounded in, when the conversation recorded it. */
  contextLabel: string | null;
};

export type ProfileAchievementCard = {
  kind: "profile-achievement";
  displayName: string;
  username: string;
  avatarUrl: string | null;
  joinedLabel: string;
  stats: ShareStat[];
  badges: { name: string; description: string | null }[];
};

export type ShareCardData =
  | LiveScoreCard
  | PlayerPerformanceCard
  | PlayerComparisonCard
  | PredictionCard
  | FantasyPerformanceCard
  | LeagueTableCard
  | TransferCard
  | AiInsightCard
  | ProfileAchievementCard;

/** Human title for each kind — used in the sheet header and the download
 * filename, nowhere on the card itself. */
export const SHARE_CARD_TITLE: Record<ShareCardKind, string> = {
  "live-score": "Score card",
  "player-performance": "Player card",
  "player-comparison": "Comparison card",
  prediction: "Prediction card",
  "fantasy-performance": "Fantasy card",
  "league-table": "Table card",
  transfer: "Transfer card",
  "ai-insight": "Insight card",
  "profile-achievement": "Profile card",
};
