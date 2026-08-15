"use client";

import { useEffect, useState } from "react";
import { useSupabaseClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";

type FixtureRealtimeFields = Pick<
  Database["public"]["Tables"]["fixtures"]["Row"],
  "id" | "status" | "home_score" | "away_score" | "minute_elapsed"
>;

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

  useEffect(() => {
    if (initialFixtures.length === 0) return;
    const ids = new Set(initialFixtures.map((f) => f.id));

    const channel = supabase
      .channel(`fixtures-live-${[...ids].sort().join(",")}`)
      .on<Database["public"]["Tables"]["fixtures"]["Row"]>(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "fixtures" },
        (payload) => {
          const updated = payload.new;
          if (!ids.has(updated.id)) return;
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
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // initialFixtures is intentionally excluded: re-subscribing on every
    // fixture-list identity change (which the first effect above already
    // handles for content) would tear down and rebuild the channel far more
    // than necessary. The subscription only needs to change when the *set*
    // of ids being watched changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, initialFixtures.length, initialFixtures.map((f) => f.id).join(",")]);

  return fixtures;
}
