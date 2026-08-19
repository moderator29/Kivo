"use client";

import { useEffect, useRef } from "react";
import { safeSubscribe } from "@/lib/realtime-safe";
import { useSupabaseClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";

/**
 * The Supabase Realtime half of /social's feed, split out of SocialFeed so
 * that it can be wrapped in a SoftErrorBoundary (see
 * src/components/ui/soft-error-boundary.tsx for why: an unreadable page is
 * a far worse outcome than a missing "New posts" pill).
 *
 * Renders nothing. It only watches for INSERTs on `posts` newer than what the
 * reader has loaded and calls `onNewPosts` — never inserting a post into the
 * list itself, which would jump content under a reader's cursor.
 *
 * `useSupabaseClient()` is called here rather than in SocialFeed on purpose:
 * this component is the *only* thing on the page that needs a browser client,
 * so this is the only subtree a client-construction failure can take down.
 */
export function NewPostsWatcher({
  followingOnly,
  latestCreatedAt,
  onNewPosts,
}: {
  followingOnly: boolean;
  /** createdAt of the newest post currently rendered, or null for an empty feed. */
  latestCreatedAt: string | null;
  onNewPosts: () => void;
}) {
  const supabase = useSupabaseClient();

  // Both kept in refs and synced after commit (never read/written during
  // render) so the subscription below can mount once and still see current
  // values, instead of tearing down and resubscribing on every new post.
  const latestCreatedAtRef = useRef(latestCreatedAt);
  useEffect(() => {
    latestCreatedAtRef.current = latestCreatedAt;
  }, [latestCreatedAt]);

  const onNewPostsRef = useRef(onNewPosts);
  useEffect(() => {
    onNewPostsRef.current = onNewPosts;
  }, [onNewPosts]);

  // Only populated for the "Following" tab — the viewer's own followed
  // author ids, read once via the browser client so RLS (`follows_select_own`)
  // scopes it to the signed-in viewer automatically. Used to decide whether
  // an INSERT the realtime channel sees is actually relevant to this tab,
  // the same filter fetchPostsPage already applies server-side for the
  // initial page.
  const followedAuthorIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!followingOnly) {
      followedAuthorIdsRef.current = null;
      return;
    }
    let cancelled = false;
    supabase
      .from("follows")
      .select("followed_id")
      .eq("followed_type", "user")
      .then(({ data }) => {
        if (!cancelled) followedAuthorIdsRef.current = new Set((data ?? []).map((f) => f.followed_id));
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, followingOnly]);

  useEffect(() => {
    const channel = supabase
      .channel("posts-feed")
      .on<Database["public"]["Tables"]["posts"]["Row"]>(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "posts" },
        (payload) => {
          const inserted = payload.new;
          const newest = latestCreatedAtRef.current;
          if (newest && new Date(inserted.created_at).getTime() <= new Date(newest).getTime()) return;
          if (followingOnly) {
            const followed = followedAuthorIdsRef.current;
            if (!followed || !followed.has(inserted.author_profile_id)) return;
          }
          onNewPostsRef.current();
        },
      )
      ;

    // Realtime is an enhancement; a socket that cannot open must not take
    // the page down. See src/lib/realtime-safe.ts.
    const teardown = safeSubscribe(channel, "newPosts", (c) => supabase.removeChannel(c));

    return () => {
      teardown();
    };
  }, [supabase, followingOnly]);

  return null;
}
