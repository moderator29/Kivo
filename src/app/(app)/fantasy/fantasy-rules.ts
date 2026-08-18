/**
 * Pure, framework-agnostic fantasy squad rules — no DB / server-only imports,
 * so this module is safe to import from both server code (src/lib/fantasy.ts,
 * actions.ts) and client components (the pitch/picker UI), keeping a single
 * source of truth for validation instead of duplicating quota logic in two
 * places. Deliberately kept inside src/app/(app)/fantasy/** per this task's
 * file-scope constraint, rather than living in src/lib alongside the
 * server-only DB helpers.
 */

/** KIVO's internal fantasy squad-budget cap, FPL-style "millions" — a game-
 * balance constant chosen for headroom over the flat starting price, not
 * derived from any real-world figure. */
export const FANTASY_BUDGET_CAP = 100.0;

/** Flat, clearly-arbitrary starting price every player is backfilled with —
 * see the fantasy_player_prices migration comment for why this isn't real
 * per-player differentiation. */
export const DEFAULT_FANTASY_PRICE = 5.0;

export const POSITION_GROUPS = ["Goalkeepers", "Defenders", "Midfielders", "Forwards"] as const;
export type PositionGroup = (typeof POSITION_GROUPS)[number];
export type PositionGroupOrOther = PositionGroup | "Other";

/**
 * `players.position` is intentionally free text (providers vary), so this is
 * the single classifier every consumer shares: fantasy's own squad-rules
 * code, `players/actions.ts`'s search filter, and `teams/[id]/page.tsx`'s
 * squad-by-group view (which also imports the `PositionGroupOrOther` type
 * above, aliased locally as `PositionGroup`, to type its own display-only
 * `POSITION_GROUPS` list). That page treats "Other" as a real, visible squad
 * section; fantasy below treats it as an invalid pick (`validateRoster`
 * rejects it) since an unrecognised position can't be slotted into a
 * formation. Same taxonomy, deliberately different handling of the
 * unclassified bucket — not an accidental drift.
 */
export function positionGroup(position: string | null): PositionGroupOrOther {
  if (!position) return "Other";
  const p = position.toLowerCase();
  if (p.includes("keeper") || p === "gk") return "Goalkeepers";
  if (p.includes("back") || p.includes("defen") || p === "df") return "Defenders";
  if (p.includes("mid") || p === "mf") return "Midfielders";
  if (p.includes("forward") || p.includes("striker") || p.includes("wing") || p === "fw" || p === "st") {
    return "Forwards";
  }
  return "Other";
}

// Classic fantasy-football squad shape (the FPL convention: 2 GK / 5 DEF / 5
// MID / 3 FWD = 15) — a well-established genre standard, not a fabricated rule.
export const SQUAD_RULES: Record<PositionGroup, number> = {
  Goalkeepers: 2,
  Defenders: 5,
  Midfielders: 5,
  Forwards: 3,
};
export const SQUAD_SIZE = 15;

export const STARTING_XI_SIZE = 11;
// Valid real-football formation bounds for the starting XI (e.g. 4-4-2,
// 3-5-2, 4-3-3, ... all fall within these min/max per group).
export const STARTING_RULES: Record<PositionGroup, { min: number; max: number }> = {
  Goalkeepers: { min: 1, max: 1 },
  Defenders: { min: 3, max: 5 },
  Midfielders: { min: 2, max: 5 },
  Forwards: { min: 1, max: 3 },
};

export const BENCH_SIZE = SQUAD_SIZE - STARTING_XI_SIZE;

export type RosterPick = {
  playerId: string;
  positionGroup: PositionGroupOrOther;
  price: number;
  isStarting: boolean;
  /** Display name, used only to name the offending pick in a validation
   * error (e.g. "Alex Carter doesn't have a recognised position yet").
   * Optional because not every caller has it handy; validation still works
   * without it, just with a less specific message. */
  name?: string;
};

export type RosterValidation = { ok: true } | { ok: false; error: string };

/** Authoritative squad-shape + budget + formation validator. Called both
 * server-side (the real source of truth, in setGameweekRoster) and
 * client-side (for live "why is Save disabled" UI feedback) — same rules
 * either way, so the two never drift. */
export function validateRoster(picks: RosterPick[]): RosterValidation {
  if (picks.length !== SQUAD_SIZE) {
    return { ok: false, error: `Your squad needs exactly ${SQUAD_SIZE} players (you have ${picks.length}).` };
  }

  const seen = new Set<string>();
  const counts: Record<PositionGroup, number> = { Goalkeepers: 0, Defenders: 0, Midfielders: 0, Forwards: 0 };
  const startingCounts: Record<PositionGroup, number> = { Goalkeepers: 0, Defenders: 0, Midfielders: 0, Forwards: 0 };
  let totalCost = 0;
  let startingCount = 0;

  for (const pick of picks) {
    if (seen.has(pick.playerId)) {
      return { ok: false, error: "Each player can only appear once in your squad." };
    }
    seen.add(pick.playerId);

    if (pick.positionGroup === "Other") {
      return {
        ok: false,
        error: pick.name
          ? `${pick.name} doesn't have a recognised position yet. Remove them or try a different player.`
          : "One of your picks doesn't have a recognised position yet. Try a different player.",
      };
    }

    counts[pick.positionGroup]++;
    totalCost += pick.price;
    if (pick.isStarting) {
      startingCounts[pick.positionGroup]++;
      startingCount++;
    }
  }

  for (const group of POSITION_GROUPS) {
    if (counts[group] !== SQUAD_RULES[group]) {
      return {
        ok: false,
        error: `Your squad needs exactly ${SQUAD_RULES[group]} ${group.toLowerCase()} (you have ${counts[group]}).`,
      };
    }
  }

  if (totalCost > FANTASY_BUDGET_CAP + 1e-9) {
    return {
      ok: false,
      error: `Your squad costs ${formatFantasyPrice(totalCost)}, over the ${formatFantasyPrice(FANTASY_BUDGET_CAP)} budget.`,
    };
  }

  if (startingCount !== STARTING_XI_SIZE) {
    return {
      ok: false,
      error: `Your starting XI needs exactly ${STARTING_XI_SIZE} players (you have ${startingCount}).`,
    };
  }

  for (const group of POSITION_GROUPS) {
    const rule = STARTING_RULES[group];
    if (startingCounts[group] < rule.min || startingCounts[group] > rule.max) {
      return {
        ok: false,
        error:
          rule.min === rule.max
            ? `Your starting XI needs exactly ${rule.min} ${group.toLowerCase()} (you have ${startingCounts[group]}).`
            : `Your starting XI needs between ${rule.min} and ${rule.max} ${group.toLowerCase()} (you have ${startingCounts[group]}).`,
      };
    }
  }

  return { ok: true };
}

/** "£4.5m"-style formatting — genre convention for fantasy football prices,
 * distinct from ever labelling this as real market value. */
export function formatFantasyPrice(price: number): string {
  return `£${price.toFixed(1)}m`;
}

const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — avoids visual ambiguity

export function generateInviteCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += INVITE_CODE_ALPHABET[Math.floor(Math.random() * INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

export function formatDeadlineCountdown(deadlineAt: string, now: Date = new Date()): string {
  const diffMs = new Date(deadlineAt).getTime() - now.getTime();
  if (diffMs <= 0) return "Deadline passed";

  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// The absolute kickoff-deadline time that used to be formatted here is now
// rendered by <LocalDateTime format="deadline"> (src/components/ui/relative-time.tsx).
// It was an `Intl.DateTimeFormat(undefined, …)` inside a Client Component,
// which meant the server formatted the deadline in its own locale and zone and
// the browser disagreed on both — a hydration mismatch, and a fantasy deadline
// shown at the wrong hour for anyone outside UTC.

export type DeadlineUrgency = "normal" | "soon" | "urgent" | "passed";

/** Coarse urgency tier for the countdown's color, so "45m" reads as visibly
 * more urgent than "6d 22h" well before the deadline actually locks the
 * gameweek (that hard cutover is `locked`, computed separately). */
export function deadlineUrgency(deadlineAt: string, now: Date = new Date()): DeadlineUrgency {
  const diffMs = new Date(deadlineAt).getTime() - now.getTime();
  if (diffMs <= 0) return "passed";
  const hoursRemaining = diffMs / 3_600_000;
  if (hoursRemaining < 1) return "urgent";
  if (hoursRemaining < 24) return "soon";
  return "normal";
}
