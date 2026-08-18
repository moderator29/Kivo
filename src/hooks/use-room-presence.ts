"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useSupabaseClient } from "@/lib/supabase/client";

export type RoomPresence = {
  /** Distinct people with this Room open right now. Real connected clients,
   * keyed by profile id so two tabs of the same person count once. Zero until
   * the channel has synced — never a placeholder. */
  watching: number;
  /** Display names of other people currently composing. Excludes the viewer. */
  typingNames: string[];
};

const EMPTY: RoomPresence = { watching: 0, typingNames: [] };

type TrackedState = { name: string; typing: boolean };

/**
 * Supabase Realtime Presence for a fixture's Match Room (KN-62).
 *
 * A Room is genuinely live — `useRealtimeRoomPosts` merges every insert as it
 * happens — but a viewer arriving at half-time had no way to tell whether they
 * were in a room of forty people or completely alone, which is the difference
 * between a place worth saying something in and a void.
 *
 * **This number is never invented.** It is the count of presence keys on a
 * channel: real browsers, really connected, right now. It is zero before the
 * first sync and it renders as nothing at all in that state (see MatchRoomTab)
 * rather than as "1 watching" inferred from the fact that you are here. There
 * is deliberately no floor, no "12 people are here" when there is one, and no
 * historical-visitor count dressed up as live presence.
 *
 * Keyed by profile id, not by connection: someone with the match open on a
 * phone and a laptop is one person watching, and counting connections would
 * have quietly inflated every number in the product's most social surface.
 *
 * Names are only ever attached to *typing*, never to the watching count.
 * Somebody reading a Room has not chosen to announce themselves; somebody
 * typing into it is a second away from posting publicly under that same name.
 */
export function useRoomPresence(
  fixtureId: string,
  viewer: { id: string; name: string } | null,
  isTyping: boolean,
): RoomPresence {
  const supabase = useSupabaseClient();
  const [presence, setPresence] = useState<RoomPresence>(EMPTY);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Read inside the subscribe callback without making the effect depend on it
  // (which would tear down and rebuild the channel on every keystroke). Written
  // from an effect rather than during render — the same rule
  // use-realtime-room-posts.ts follows for its own postsRef.
  const typingRef = useRef(isTyping);
  useEffect(() => {
    typingRef.current = isTyping;
  }, [isTyping]);

  const viewerId = viewer?.id ?? null;
  const viewerName = viewer?.name ?? null;

  useEffect(() => {
    // No identity, no presence. The app is gated so this is effectively always
    // set, but tracking an anonymous key would put an unnamed body in the count.
    // Nothing to reset here — `presence` only ever leaves EMPTY from a real
    // sync on a real channel, which cannot have happened without an identity.
    if (!viewerId || !viewerName) return;

    const channel = supabase.channel(`room-presence-${fixtureId}`, {
      config: { presence: { key: viewerId } },
    });
    channelRef.current = channel;

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<TrackedState>();
      const keys = Object.keys(state);
      const typingNames: string[] = [];
      for (const key of keys) {
        if (key === viewerId) continue;
        // One person can have several connections; they are typing if any of
        // them is.
        const entries = state[key] ?? [];
        const typingEntry = entries.find((entry) => entry.typing);
        if (typingEntry?.name) typingNames.push(typingEntry.name);
      }
      setPresence({ watching: keys.length, typingNames });
    });

    channel.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      void channel.track({ name: viewerName, typing: typingRef.current } satisfies TrackedState);
    });

    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [supabase, fixtureId, viewerId, viewerName]);

  // Republish only the typing flag when it flips. Separate from the effect
  // above on purpose: re-tracking is cheap, re-subscribing is not, and a
  // channel that tore down on every keystroke would make the watching count
  // flicker for everyone else in the Room.
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel || !viewerName) return;
    void channel.track({ name: viewerName, typing: isTyping } satisfies TrackedState);
  }, [isTyping, viewerName]);

  return presence;
}
