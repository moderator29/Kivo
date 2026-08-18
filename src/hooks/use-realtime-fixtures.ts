"use client";

import { useEffect, useState } from "react";
import { useSupabaseClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";

type FixtureRealtimeFields = Pick<
  Database["public"]["Tables"]["fixtures"]["Row"],
  "id" | "status" | "home_score" | "away_score" | "minute_elapsed"
>;

/**
 * How many fixture ids go into one `id=in.(…)` server-side filter.
 *
 * KIVO_NEXT_GEN KN-6: this hook used to register a bare
 * `{ event: "UPDATE", schema: "public", table: "fixtures" }` with no filter and
 * then discard non-matching ids client-side. On a broad sync day that is every
 * fixture in the database pushed down every connected client's websocket — on a
 * product whose stated launch market is mobile-network-constrained, and paid for
 * in the user's own data. `use-realtime-room-posts.ts` already did this
 * correctly with a server-side filter; this brings fixtures in line.
 *
 * Chunked rather than one giant filter because the watched set is a whole page
 * of fixtures, and the filter is parsed and evaluated per change by the Realtime
 * server. Several bindings on one channel (which the protocol supports, and
 * which the server ORs together for us by simply delivering each match) keeps
 * every filter short without opening a channel per chunk.
 */
const IDS_PER_FILTER = 40;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The Realtime half of the live-data architecture (docs/LIVE_DATA.md): a
 * single upstream write to `fixtures` (today: an admin's "Sync now"; later:
 * an automated live worker, once FOOTBALL_LIVE_POLLING_ENABLED is genuinely
 * turned on) fans out to every subscribed client via Supabase's Postgres
 * Changes feed instead of each client polling anything itself. `fixtures`
 * is in the `supabase_realtime` publication as of migration
 * 0038_realtime_fixture_distribution, and already public-select via RLS, so
 * this works identically signed in or as a guest.
 *
 * Deliberately narrow: only the fields a live match view actually needs to
 * react to (score/status/minute) are merged in, so a Realtime payload can
 * never silently overwrite the richer server-fetched row shape (team
 * crests, competition, etc.) with `null`s for columns this feed doesn't
 * carry.
 */
export function useRealtimeFixtures<T extends FixtureRealtimeFields>(initialFixtures: T[]): T[] {
  const supabase = useSupabaseClient();
  const [fixtures, setFixtures] = useState(initialFixtures);
  // "Adjusting state when a prop changes" during render, per React's own
  // guidance, rather than syncing it back via a second useEffect: a fresh
  // server-fetched initialFixtures array (new page navigation, a refresh)
  // should immediately replace the accumulated Realtime-merged state, not
  // wait a render+effect cycle to do so.
  const [prevInitialFixtures, setPrevInitialFixtures] = useState(initialFixtures);
  if (initialFixtures !== prevInitialFixtures) {
    setPrevInitialFixtures(initialFixtures);
    setFixtures(initialFixtures);
  }

  const watchedIds = initialFixtures
    .map((f) => f.id)
    .sort()
    .join(",");

  useEffect(() => {
    if (!watchedIds) return;
    const ids = watchedIds.split(",");

    let channel = supabase.channel(`fixtures-live-${watchedIds}`);

    for (const group of chunk(ids, IDS_PER_FILTER)) {
      channel = channel.on<Database["public"]["Tables"]["fixtures"]["Row"]>(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "fixtures",
          // Fixture ids are uuids, so no value here can contain a character
          // the filter grammar treats as reserved — no quoting needed.
          filter: `id=in.(${group.join(",")})`,
        },
        (payload) => {
          const updated = payload.new;
          setFixtures((prev) =>
            prev.map((f) =>
              f.id === updated.id
                ? {
                    ...f,
                    status: updated.status,
                    home_score: updated.home_score,
                    away_score: updated.away_score,
                    minute_elapsed: updated.minute_elapsed,
                  }
                : f,
            ),
          );
        },
      );
    }

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // The subscription only needs to change when the *set* of ids being
    // watched changes — `watchedIds` is exactly that set, sorted, so a
    // reordered or content-updated list of the same fixtures doesn't tear the
    // channel down and rebuild it.
  }, [supabase, watchedIds]);

  return fixtures;
}
