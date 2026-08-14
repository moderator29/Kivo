"use client";

import { useEffect } from "react";
import { recordRecentlyViewed, type RecentlyViewedType } from "@/lib/recently-viewed";

/**
 * Invisible: records the current entity into the localStorage "recently
 * viewed" list on mount, then renders nothing. Mounted once per detail page
 * (teams/[id], players/[id], leagues/[id]) with that entity's real data.
 */
export function TrackView({
  type,
  id,
  name,
  imageUrl,
}: {
  type: RecentlyViewedType;
  id: string;
  name: string;
  imageUrl: string | null;
}) {
  useEffect(() => {
    recordRecentlyViewed({ type, id, name, imageUrl });
  }, [type, id, name, imageUrl]);

  return null;
}
