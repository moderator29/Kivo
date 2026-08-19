"use client";

import { Suspense, type ReactNode } from "react";
import { SectionTabs, TabPanel, useTabParam, type SectionTab } from "@/components/ui/section-tabs";

/**
 * The bridge that lets a SERVER-rendered entity page use KIVO's one tab rail.
 *
 * This is not a second tab bar and must never become one. `SectionTabs`
 * (`src/components/ui/section-tabs.tsx`, documented in `docs/UI_PRIMITIVES.md`)
 * does all of the work: the scrolling rail, the moving indicator, the roving
 * tabindex, the 44px targets. What it cannot do is be called from a server
 * component, because it is controlled and `useTabParam` is a hook.
 *
 * `/teams/[id]` and `/players/[id]` are server components whose panels are
 * mostly server-rendered — a squad list, a league table, an async community
 * feed. So each panel arrives here as an already-rendered `ReactNode` and this
 * file's only job is to hold the selected id and hand it to the shared rail.
 *
 * Twelve lines of glue rather than a fork. If a behaviour is missing from the
 * rail, it gets fixed in `section-tabs.tsx` for every surface at once.
 */
export type EntityTab = SectionTab & { content: ReactNode };

function EntityTabsInner({
  tabs,
  ariaLabel,
  idPrefix,
}: {
  tabs: EntityTab[];
  ariaLabel: string;
  idPrefix: string;
}) {
  const [active, setActive] = useTabParam({ tabs: tabs.map((tab) => tab.id) });

  return (
    <div className="flex flex-col gap-5">
      <SectionTabs
        tabs={tabs}
        value={active}
        onChange={setActive}
        ariaLabel={ariaLabel}
        idPrefix={idPrefix}
        sticky
        bleed
      />
      {tabs.map((tab) => (
        <TabPanel
          key={tab.id}
          idPrefix={idPrefix}
          tab={tab.id}
          active={active === tab.id}
          className="flex flex-col gap-6"
        >
          {tab.content}
        </TabPanel>
      ))}
    </div>
  );
}

/**
 * `useTabParam` calls `useSearchParams`, so it needs a Suspense boundary. The
 * fallback is the real rail with the first tab selected and its real content
 * already rendered — so the boundary costs no spinner and no reflow, and the
 * page's primary content is in the first HTML either way.
 */
export function EntityTabs({
  tabs,
  ariaLabel,
  idPrefix,
}: {
  tabs: EntityTab[];
  ariaLabel: string;
  idPrefix: string;
}) {
  if (tabs.length === 0) return null;
  // One tab is not a tab bar. A rail with a single destination is a label the
  // reader cannot act on, so the panel simply renders on its own.
  if (tabs.length === 1) return <div className="flex flex-col gap-6">{tabs[0].content}</div>;

  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-5">
          <SectionTabs
            tabs={tabs}
            value={tabs[0].id}
            onChange={() => {}}
            ariaLabel={ariaLabel}
            idPrefix={idPrefix}
            sticky
            bleed
          />
          <TabPanel idPrefix={idPrefix} tab={tabs[0].id} active className="flex flex-col gap-6">
            {tabs[0].content}
          </TabPanel>
        </div>
      }
    >
      <EntityTabsInner tabs={tabs} ariaLabel={ariaLabel} idPrefix={idPrefix} />
    </Suspense>
  );
}
