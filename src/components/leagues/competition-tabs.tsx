"use client";

import { Suspense, type ReactNode } from "react";
import { SectionTabs, TabPanel, useTabParam, type SectionTab } from "@/components/ui/section-tabs";

/**
 * The competition page's sections.
 *
 * Thin on purpose. `SectionTabs` is the one tab rail in the product
 * (docs/UI_PRIMITIVES.md) and it is controlled, so all this adds is the URL
 * binding and the panel wiring — and, more importantly, it adds them for a
 * page whose panels are entirely server-rendered.
 *
 * Every section's content arrives as an already-rendered node from the server
 * component. That is what lets the table, the fixture lists and the scoring
 * chart stay server components with their own data reads while the rail — the
 * one genuinely interactive part — is the only thing shipped to the browser.
 * The alternative, passing raw rows down and rendering here, would turn a
 * league table into client JavaScript for no gain a reader can see.
 *
 * `icon` is deliberately not accepted: a `LucideIcon` is a function and cannot
 * cross the server/client boundary, and a competition's sections read
 * perfectly well as words.
 */
export type CompetitionSection = {
  id: string;
  /** What a fan calls it: "Table", "Fixtures". Never a slug. */
  label: string;
  /** A real count, or omitted. Never 0. */
  count?: number;
  content: ReactNode;
};

export function CompetitionTabs({ sections }: { sections: CompetitionSection[] }) {
  return (
    // useTabParam reads useSearchParams, so it needs a boundary above it. The
    // fallback renders the first section's content with no rail rather than a
    // spinner: that is what the page shows anyway, and a competition flashing
    // an empty frame before its table is the kind of thing that makes a fast
    // page feel slow.
    <Suspense fallback={<div>{sections[0]?.content}</div>}>
      <CompetitionTabsInner sections={sections} />
    </Suspense>
  );
}

function CompetitionTabsInner({ sections }: { sections: CompetitionSection[] }) {
  const ids = sections.map((section) => section.id);
  const [active, setActive] = useTabParam({ tabs: ids });

  const tabs: SectionTab<string>[] = sections.map(({ id, label, count }) => ({ id, label, count }));

  return (
    <div className="flex flex-col gap-4">
      <SectionTabs
        tabs={tabs}
        value={active}
        onChange={setActive}
        ariaLabel="Competition sections"
        idPrefix="competition"
        sticky
        bleed
      />
      {sections.map((section) => (
        <TabPanel key={section.id} idPrefix="competition" tab={section.id} active={active === section.id}>
          {section.content}
        </TabPanel>
      ))}
    </div>
  );
}
