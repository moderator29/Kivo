"use client";

import { useEffect, useRef, useState } from "react";
import { useSupabaseClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";
import type { MatchEvent } from "@/components/matches/match-centre-tabs";

type FixtureEventsRow = Database["public"]["Tables"]["fixture_events"]["Row"];

/**
 * Live push for the Match Centre's Timeline tab.
 *
 * The gap this closes: `fixtures` has been Realtime-distributed since
 * migration 0038, so a goal already moves the score in the hero above these
 * tabs (see match-score-display.tsx) — but `fixture_events` was in that same
 * publication with nothing subscribed to it, so the timeline underneath still
 * showed the match as it stood when the page was server-rendered. A fan
 * watching a live match saw the score tick to 1-0 above a timeline that
 * insisted nothing had happened, and had to reload the page to find out who
 * scored. Same publication, same RLS (`fixture_events_select_public`, migration
 * 0001, so this works identically signed in or logged out), no new migration
 * and no widened read access — the channel was already open.
 *
 * WHY ALL THREE EVENT KINDS, NOT JUST INSERT
 * --------------------------------------------------------------------------
 * The room-posts hook only needs INSERT and DELETE because a post is written
 * once. A football event is not: the QA directive names "live goal and
 * corrected goal" as its own scenario, and both corrections are real provider
 * behaviour, not hypotheticals.
 *
 *   INSERT — the goal, card or substitution just happened.
 *   UPDATE — the same event, re-stated. A goal reassigned to a different
 *            scorer after the dust settles, a minute corrected, a detail
 *            filled in. Merging by id means the timeline restates it rather
 *            than showing the fan two contradictory versions of one goal.
 *   DELETE — VAR took it away. A disallowed goal must leave the timeline,
 *            because the hero's score has already dropped back and a timeline
 *            still crediting a scorer for a goal that no longer exists is the
 *            single most visible way this screen could lie.
 *
 * DELETE is subscribed unfiltered, deliberately, for the same reason
 * use-realtime-room-posts.ts documents: Postgres sends only the replica
 * identity (the primary key) on a delete, so a `fixture_id=eq.…` filter has no
 * column to match against and would silently drop every deletion. Filtering
 * client-side costs nothing here — the payload is one uuid, and an id this
 * client has never heard of is a no-op.
 *
 * NAMES, NOT UUIDS
 * --------------------------------------------------------------------------
 * A raw `postgres_changes` payload is the row itself: `player_id`, not the
 * joined player name the page assembles server-side. Rather than render
 * "Unknown player" for the one event a fan most wants to read, this resolves
 * the ids against `players` — public-select under the same migration 0001
 * policy — and only then merges the event in. If that lookup fails, the event
 * still lands with a null name rather than being dropped: a goal on the
 * timeline with an unnamed scorer is worth strictly more than no goal at all.
 */

/** Ordering has to match the server's (`order("minute", ascending: true)`) or a
 * live arrival would land in a different place than it occupies after the next
 * navigation. `added_time` breaks the tie inside a minute — 90+4 comes after
 * 90 — and the id breaks it for two events genuinely stamped the same minute
 * and added time, which is arbitrary but stable: the same two events never
 * swap places between renders, or between this list and the server's. */
function compareEvents(a: MatchEvent, b: MatchEvent): number {
  if (a.minute !== b.minute) return a.minute - b.minute;
  const aAdded = a.addedTime ?? 0;
  const bAdded = b.addedTime ?? 0;
  if (aAdded !== bAdded) return aAdded - bAdded;
  return a.id.localeCompare(b.id);
}

export function useRealtimeFixtureEvents(
  fixtureId: string,
  initialEvents: MatchEvent[],
  /** False for a fixture whose event record can no longer change — a finished,
   * cancelled, postponed or abandoned match. KIVO's stated launch market is
   * mobile-network-constrained, and holding a websocket channel open on the
   * archive page of a match from three seasons ago spends a fan's data to be
   * told nothing. The server-rendered list is already the whole story there. */
  enabled: boolean,
): { events: MatchEvent[]; liveIds: ReadonlySet<string> } {
  const supabase = useSupabaseClient();
  const [events, setEvents] = useState(initialEvents);

  /** Ids that arrived or changed over the wire during this page's life, so the
   * Timeline can flash exactly the row that moved (`kivo-row-flash`) instead of
   * animating the whole list. Never populated from `initialEvents`: a
   * server-rendered event is not news, and flashing the whole timeline on load
   * would make the cue meaningless. */
  const [liveIds, setLiveIds] = useState<ReadonlySet<string>>(() => new Set());

  // Same "adjust state when a prop changes" shape as useRealtimeFixtures and
  // useRealtimeRoomPosts: a fresh server-fetched array (a navigation, a
  // revalidate after an admin sync) always wins over whatever Realtime
  // accumulated locally, which is what makes the merges below self-healing
  // rather than something that has to be perfect to stay correct.
  const [prevInitialEvents, setPrevInitialEvents] = useState(initialEvents);
  if (initialEvents !== prevInitialEvents) {
    setPrevInitialEvents(initialEvents);
    setEvents(initialEvents);
  }

  // Read fresh inside the subscription callback without forcing a resubscribe
  // on every merge. Only a fast-path skip; the functional setEvents updates are
  // the actual dedupe guarantee.
  const eventsRef = useRef(events);
  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  useEffect(() => {
    if (!fixtureId || !enabled) return;
    let cancelled = false;

    async function toMatchEvent(row: FixtureEventsRow): Promise<MatchEvent> {
      const ids = [row.player_id, row.related_player_id].filter((id): id is string => Boolean(id));

      let names = new Map<string, string>();
      if (ids.length > 0) {
        const { data } = await supabase.from("players").select("id, full_name, known_as").in("id", ids);
        names = new Map((data ?? []).map((p) => [p.id, p.known_as || p.full_name]));
      }

      return {
        id: row.id,
        eventType: row.event_type,
        minute: row.minute,
        addedTime: row.added_time,
        detail: row.detail,
        teamId: row.team_id,
        playerId: row.player_id,
        playerName: row.player_id ? (names.get(row.player_id) ?? null) : null,
        relatedPlayerId: row.related_player_id,
        relatedPlayerName: row.related_player_id ? (names.get(row.related_player_id) ?? null) : null,
      };
    }

    function merge(event: MatchEvent) {
      if (cancelled) return;
      setEvents((prev) => {
        const without = prev.filter((e) => e.id !== event.id);
        return [...without, event].sort(compareEvents);
      });
      setLiveIds((prev) => new Set(prev).add(event.id));
    }

    const channel = supabase
      .channel(`fixture-events-${fixtureId}`)
      .on<FixtureEventsRow>(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "fixture_events", filter: `fixture_id=eq.${fixtureId}` },
        (payload) => {
          if (eventsRef.current.some((e) => e.id === payload.new.id)) return;
          void toMatchEvent(payload.new).then(merge);
        },
      )
      .on<FixtureEventsRow>(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "fixture_events", filter: `fixture_id=eq.${fixtureId}` },
        (payload) => {
          void toMatchEvent(payload.new).then(merge);
        },
      )
      // Unfiltered on purpose — a DELETE payload carries only the primary key,
      // so there is no fixture_id on it for the server to filter by. See the
      // doc comment above.
      .on<FixtureEventsRow>(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "fixture_events" },
        (payload) => {
          const removedId = (payload.old as Partial<FixtureEventsRow>)?.id;
          if (!removedId || cancelled) return;
          setEvents((prev) => (prev.some((e) => e.id === removedId) ? prev.filter((e) => e.id !== removedId) : prev));
          setLiveIds((prev) => {
            if (!prev.has(removedId)) return prev;
            const next = new Set(prev);
            next.delete(removedId);
            return next;
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [supabase, fixtureId, enabled]);

  return { events, liveIds };
}
