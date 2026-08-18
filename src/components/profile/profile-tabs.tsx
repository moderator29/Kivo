import Link from "next/link";

export const PROFILE_TABS = ["posts", "predictions", "badges"] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

export function isProfileTab(value: string | undefined): value is ProfileTab {
  return !!value && (PROFILE_TABS as readonly string[]).includes(value);
}

const TAB_LABELS: Record<ProfileTab, string> = {
  posts: "Posts",
  predictions: "Predictions",
  badges: "Badges",
};

/**
 * The content switcher on `/profile`.
 *
 * Real links carrying `?tab=`, not client state: the tab a person is looking
 * at survives a reload, a share and the browser's back button, and each panel
 * is rendered on the server from its own query rather than all three being
 * fetched and hidden. That is also what keeps the page honest about cost —
 * opening the profile does not load a prediction history nobody asked to see.
 *
 * `scroll={false}` because the header above stays put between tabs; jumping to
 * the top of a page that did not change is the classic tell that a tab bar is
 * really a navigation.
 */
export function ProfileTabs({ active }: { active: ProfileTab }) {
  return (
    <nav aria-label="Profile sections" className="border-b border-hairline-soft">
      <ul className="flex items-stretch gap-1">
        {PROFILE_TABS.map((tab) => {
          const isActive = tab === active;
          return (
            <li key={tab} className="flex-1">
              <Link
                href={`/profile?tab=${tab}`}
                scroll={false}
                aria-current={isActive ? "page" : undefined}
                className={`kivo-focus relative flex items-center justify-center px-2 py-3 text-sm font-medium transition-colors ${
                  isActive ? "text-foreground" : "text-foreground-subtle hover:text-foreground-muted"
                }`}
              >
                {TAB_LABELS[tab]}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="kivo-gradient-prime absolute inset-x-2 -bottom-px h-0.5 rounded-full"
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
