import type { ReactNode } from "react";
import { AdminSectionTabs } from "@/components/admin/admin-section-tabs";
import { footballDataGate } from "./access";

/**
 * The Football data section: Provider, Coverage, Pipeline, Integrity.
 *
 * ## The segment name
 *
 * This directory was `data-health` until now. RECOMMENDATIONS A2 kept the wrong
 * name deliberately: six agents were importing server actions out of
 * `src/app/admin/data-health/*-actions.ts`, and renaming the segment would have
 * moved seventeen import paths under them mid-pass. A better URL is worth less
 * than not breaking five working trees. The branch is quiet now, so it is
 * `/admin/football/{provider,coverage,pipeline,integrity}` — four siblings, one
 * per question the section answers, rather than three pages nested under the
 * first one. Provider is not the parent of the other three; it is the first of
 * four peers, and the old shape said otherwise.
 *
 * The old URLs redirect permanently (`next.config.ts`), because the founder
 * administers this from a phone and a bookmark is not a thing to break to make
 * a point about naming.
 *
 * ## What this layout is and is not
 *
 * It holds the two things all four pages had a copy of: the section tab rail,
 * and the *presentation* of the role denial. It is deliberately **not** the
 * authorization boundary — see the header of `./access.tsx` for the Next.js
 * documentation that says a layout cannot be one, and for why each page still
 * runs the same gate before its first query.
 */
export default async function FootballDataLayout({ children }: { children: ReactNode }) {
  const { denied } = await footballDataGate();
  if (denied) return denied;

  return (
    <div className="flex min-w-0 flex-col gap-8">
      {/* Was rendered by each of the four pages as its own first child. It is
          identical on all four, so it belongs here — and now it survives a
          navigation between them instead of being torn down and rebuilt. */}
      <AdminSectionTabs groupId="football-data" />
      {children}
    </div>
  );
}
