import "server-only";
import type { ReactNode } from "react";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { AdminAccessNotice } from "@/components/admin/admin-chrome";
import type { Profile } from "@/lib/profile";

/**
 * The one role gate the four football pages share, and the reason it is a
 * function rather than only a layout.
 *
 * ## What this replaced
 *
 * Provider, Coverage, Pipeline and Integrity each opened with the same eight
 * lines: `getOrCreateProfile()`, `canManageFootballData()`, and a hand-written
 * `<AdminAccessNotice>` whose `because` sentence named a different RLS policy
 * on each page — four chances for one of them to drift out of step with
 * `FOOTBALL_DATA_MANAGE_ROLES`. RECOMMENDATIONS A8 recorded this as "worth
 * doing, but a layout is a shared file and this branch has six agents on it".
 * The branch is quiet; this is that fix.
 *
 * ## Why the layout alone is not enough, in this version of Next
 *
 * The obvious shape — put the check in `layout.tsx`, delete it from the four
 * pages — is wrong here, and the framework says so in as many words.
 * `node_modules/next/dist/docs/01-app/02-guides/authentication.md`:
 *
 *   > A layout also does not control whether the rest of the route renders.
 *   > Route segments and parallel route slots are rendered by the router, so a
 *   > layout that hides or swaps them does not stop them from running or from
 *   > appearing in the RSC Payload.
 *
 *   > Due to Partial Rendering, be cautious when doing checks in Layouts as
 *   > these don't re-render on navigation.
 *
 * So a layout that returns a lock screen instead of `{children}` does **not**
 * stop the page underneath it from executing. Every one of these four pages
 * opens by querying `sync_runs`, `standings`, `provider_mappings` and
 * `competition_teams` — all RLS-gated. Running those as a role that cannot read
 * them returns zero rows, and RECOMMENDATIONS A3 is the rule that a
 * zero produced by an access denial is the most dangerous number this section
 * can render. The check therefore has to sit where the queries do.
 *
 * ## The division of labour
 *
 * - **The layout** calls this and, when it denies, renders the notice and drops
 *   the section tab rail. That is the half the operator sees, said once.
 * - **Each page** calls this and returns `null` when it denies, before its
 *   first query. That is the half that matters: no read is issued, so no
 *   RLS-filtered zero can be drawn as "all clear". It renders nothing because
 *   the layout above it is already showing the explanation — two stacked lock
 *   screens for one denial would be worse than the duplication this removed.
 *
 * The page's `null` is also the fail-closed answer on the partial-render path
 * the docs describe, where the page segment is rendered without this layout
 * re-running: nothing is read and nothing is emitted.
 */

/** One sentence, in one place. It names the predicate and the policy family it
 *  mirrors, because "you don't have access" without the reason is what sends an
 *  operator to guess at their own role. */
export const FOOTBALL_ACCESS_REASON =
  "Reading sync history and writing the football reference tables are limited to the football data, admin and super-admin roles — canManageFootballData() in src/lib/admin.ts, mirroring the *_insert_admin / provider_mappings_all_admin / sync_runs_all_admin policies in migration 0001.";

export type FootballDataGate = {
  /** Null when nobody is signed in or the profile row could not be read. */
  profile: Profile | null;
  /** True only when the viewer may both read and write football data. */
  permitted: boolean;
  /** The lock screen to render, or null when the viewer is permitted. Rendered
   *  by the layout; pages return `null` instead — see the header. */
  denied: ReactNode | null;
};

export async function footballDataGate(title = "Football data"): Promise<FootballDataGate> {
  const profile = await getOrCreateProfile();
  const permitted = canManageFootballData(profile?.role);

  return {
    profile,
    permitted,
    denied: permitted ? null : (
      <AdminAccessNotice
        title={title}
        role={profile?.role}
        subject="Football data"
        because={FOOTBALL_ACCESS_REASON}
      />
    ),
  };
}
