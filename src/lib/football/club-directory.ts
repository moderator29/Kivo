import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { logError } from "@/lib/log";
import {
  EMPTY_PICKER_FACETS,
  TEAM_PICKER_LIMIT,
  type PickerFacets,
  type PickerTeam,
} from "@/lib/profile-picker";

/**
 * The one place KIVO reads "which clubs are there, and which one did you
 * mean".
 *
 * WHAT WAS WRONG
 * --------------
 * Three surfaces asked that question and all three asked it badly. The profile
 * picker and onboarding both ran `select … from teams order by name limit 40`
 * and searched with a bare `name ilike '%q%'`; /settings/clubs had a better
 * answer (most-followed first) that neither of the others shared. On the live
 * database — 705 clubs, produced by one day of fixtures — the alphabetical
 * head is reserve sides and youth teams, so a new user's first impression of
 * KIVO was a club list with no clubs in it they had heard of, and no way to
 * tell whether their own was missing or two hundred rows further down.
 *
 * WHAT THIS DOES INSTEAD
 * ----------------------
 * One round trip to `search_clubs_ranked` (migration 0108), which does the
 * searching, the narrowing and the ordering in SQL where the indexes are:
 *
 * - **Search** matches the club's name *and* its short name, so "Man Utd"
 *   finds a row stored as "Manchester United" whenever the provider supplied
 *   the short form. A `%` or `_` a user types stays a literal character.
 * - **Narrowing** by competition and by country, each optional. Competition
 *   membership comes from `competition_teams` (migration 0107) — the
 *   provider's own "who is in this league this season", which does not need a
 *   match to have been played — unioned with clubs that have actually played a
 *   fixture in the competition. Two real sources; see 0108's own CTE for why
 *   that union is the definition rather than a fallback.
 * - **Ordering** by how many KIVO profiles follow the club, descending, then
 *   by name. That is the only ordering signal in the product and it is a real
 *   count of a real thing — see the migration's own header for why there is
 *   deliberately no second tier, and why a hardcoded list of clubs somebody
 *   considers major would be dishonest rather than merely lazy.
 *
 * WHAT HAPPENS WHEN THE RPC IS NOT THERE
 * --------------------------------------
 * `readClubs` falls back to a plain alphabetical `teams` read — exactly the
 * behaviour that shipped before this file — and logs. A deploy that lands
 * ahead of its migration then costs the reader the ordering, not the ability
 * to pick a club. The fallback is deliberately not silent: an ordering that
 * quietly stops ordering is indistinguishable from one that never worked.
 */

type Client = SupabaseClient<Database>;

export type ClubQuery = {
  query?: string | null;
  competitionId?: string | null;
  country?: string | null;
  limit?: number;
};

export type ClubDirectoryPage = {
  clubs: PickerTeam[];
  /** True when the ordering came from `search_clubs_ranked`. False means the
   * fallback below ran, and the list is alphabetical only — the UI says so
   * rather than implying an order it did not get. */
  ranked: boolean;
  /** True when the read failed outright. An empty list with `failed: true` is
   * "KIVO could not look", which is not the same fact as "no club matches". */
  failed: boolean;
};

export async function readClubs(supabase: Client, options: ClubQuery = {}): Promise<ClubDirectoryPage> {
  const trimmed = options.query?.trim() ?? "";
  const limit = options.limit ?? TEAM_PICKER_LIMIT;

  const { data, error } = await supabase.rpc("search_clubs_ranked", {
    p_query: trimmed.length > 0 ? trimmed.slice(0, 80) : undefined,
    p_competition_id: options.competitionId ?? undefined,
    p_country: options.country ?? undefined,
    p_limit: limit,
  });

  if (!error) {
    return {
      clubs: (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        short_name: row.short_name,
        crest_url: row.crest_url,
        country: row.country,
        follower_count: Number(row.follower_count ?? 0),
      })),
      ranked: true,
      failed: false,
    };
  }

  logError("clubDirectory.rankedSearchUnavailable", error);

  // The pre-0108 read, kept as the fallback rather than as a second code path
  // anybody maintains: same columns, no ordering signal, and no competition or
  // country narrowing (both need joins the RPC does and this does not). It
  // exists for one case — a deploy that lands ahead of its migration — and it
  // costs the reader the ordering rather than the ability to pick a club.
  let request = supabase
    .from("teams")
    .select("id, name, short_name, crest_url, country")
    .order("name", { ascending: true })
    .limit(limit);
  if (trimmed) request = request.ilike("name", `%${escapeLike(trimmed)}%`);

  const { data: rows, error: fallbackError } = await request;
  if (fallbackError) {
    logError("clubDirectory.fallbackSearchFailed", fallbackError);
    return { clubs: [], ranked: false, failed: true };
  }

  return {
    clubs: (rows ?? []).map((row) => ({ ...row, follower_count: 0 })),
    ranked: false,
    failed: false,
  };
}

/**
 * What the picker can narrow by. Never throws and never invents an option: a
 * facet with no rows comes back empty and the control for it is not rendered.
 *
 * Failure is reported as "no facets" rather than propagated, and that is a
 * considered trade rather than the usual tolerance: the facets are a
 * refinement over a list that renders perfectly well without them, so losing
 * them costs a narrowing control, while failing the page would cost the user
 * the ability to pick a club at all.
 */
export async function readClubFacets(supabase: Client): Promise<PickerFacets> {
  const { data, error } = await supabase.rpc("club_picker_facets");
  if (error) {
    logError("clubDirectory.facetsUnavailable", error);
    return EMPTY_PICKER_FACETS;
  }

  const competitions = [];
  const countries = [];
  for (const row of data ?? []) {
    const facet = { key: row.key, label: row.label, clubCount: Number(row.club_count ?? 0) };
    if (!facet.key || !facet.label) continue;
    if (row.facet === "competition") competitions.push(facet);
    else if (row.facet === "country") countries.push(facet);
  }

  // Most clubs first, then alphabetically — the same "real count, then a
  // stable tiebreak" rule the club ordering itself uses.
  const byCountThenLabel = (a: { clubCount: number; label: string }, b: { clubCount: number; label: string }) =>
    b.clubCount - a.clubCount || a.label.localeCompare(b.label);
  competitions.sort(byCountThenLabel);
  countries.sort(byCountThenLabel);

  return { competitions, countries };
}

/** Local copy of `escapeLikePattern`'s behaviour for the fallback path only;
 * the RPC does its own escaping in SQL, where a caller cannot forget to. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
