"use client";

import type { ReactNode } from "react";
import { Award, MessageSquare, Swords } from "lucide-react";
import { SectionTabs, TabPanel, useTabParam, type SectionTab } from "@/components/ui/section-tabs";

export type ProfileTab = "posts" | "badges" | "compare";

/**
 * A public profile's sections, on the app's one tab rail.
 *
 * Everything on `/u/[username]` used to stack: XP, then badges, then a
 * head-to-head panel, with the person's actual posts nowhere at all. Stacked,
 * a profile is a scroll through KIVO's opinion of somebody. Tabbed, with posts
 * first, it is the person — which is what a fan came to the page for, and what
 * makes the Follow button above it mean something.
 *
 * The panels are rendered on the server and handed in as children. This
 * component owns only which one is showing, because that is the only part that
 * has to be interactive — the posts, the badges and the comparison are all
 * real rows already fetched by the time this mounts.
 *
 * Tabs are built from what exists. `compare` is omitted entirely for a signed
 * out visitor and for somebody looking at their own profile, rather than
 * rendered greyed out: the rail's contract is that a tab you cannot use should
 * not be on screen, because "not for you" and "broken" are indistinguishable
 * once a control is dead.
 */
export function ProfileSections({
  postCount,
  badgeCount,
  showCompare,
  posts,
  badges,
  compare,
}: {
  /** Real counts only — both are the number of rows already on this page, and
   * both are omitted from the rail at zero rather than shown as "0". */
  postCount: number;
  badgeCount: number;
  showCompare: boolean;
  posts: ReactNode;
  badges: ReactNode;
  compare: ReactNode;
}) {
  const tabs: SectionTab<ProfileTab>[] = [
    { id: "posts", label: "Posts", icon: MessageSquare, ...(postCount > 0 ? { count: postCount } : {}) },
    { id: "badges", label: "Badges", icon: Award, ...(badgeCount > 0 ? { count: badgeCount } : {}) },
    ...(showCompare ? [{ id: "compare" as const, label: "Head to head", icon: Swords }] : []),
  ];

  const [active, setActive] = useTabParam<ProfileTab>({
    tabs: showCompare ? (["posts", "badges", "compare"] as const) : (["posts", "badges"] as const),
  });

  return (
    <div className="flex flex-col gap-4">
      <SectionTabs
        tabs={tabs}
        value={active}
        onChange={setActive}
        ariaLabel="Profile sections"
        idPrefix="profile"
        sticky
        bleed
      />

      <TabPanel idPrefix="profile" tab="posts" active={active === "posts"}>
        {posts}
      </TabPanel>
      <TabPanel idPrefix="profile" tab="badges" active={active === "badges"}>
        {badges}
      </TabPanel>
      {showCompare && (
        <TabPanel idPrefix="profile" tab="compare" active={active === "compare"}>
          {compare}
        </TabPanel>
      )}
    </div>
  );
}
