import type { ReactNode } from "react";
import { EmptyStateFrame } from "@/components/ui/empty-state";

/**
 * The empty state for a feature that is fully built but has nothing to show yet.
 *
 * **This is now `<EmptyState>` (src/components/ui/empty-state.tsx) under an
 * older name.** New code imports that one; it takes a lucide icon by reference
 * rather than as a pre-rendered element, and its doc comment carries the rule
 * for the words. This file stays because fourteen pages already call it, and
 * rewriting fourteen files owned by other people to change an icon's calling
 * convention would be churn with nothing visible at the end of it.
 *
 * What it is NOT any more is a second implementation. Both render
 * `<EmptyStateFrame>`, so the two cannot drift into looking slightly different
 * on different screens — which is precisely how the product ended up with four
 * match rows and two tab bars.
 *
 * The history is worth keeping because the mistake is easy to repeat: this
 * component used to end with a paragraph, on by default, explaining KIVO's
 * data pipeline to whoever hit it — that coverage is built one competition at
 * a time from a verified source, never scraped, and that an empty section
 * means nothing is broken. Plus a link to /transparency. Written in good
 * faith, and the clearest single example of the problem this rebuild exists to
 * fix: a football fan opening a club page has no mental model of KIVO's
 * ingestion strategy, did not ask for one, and cannot act on one. Handed it on
 * a dozen surfaces at once, the app read as apologising for itself rather than
 * as merely early. `/transparency` still exists and still counts everything
 * for real — it is now somewhere you go, not something you are handed while
 * looking for a squad list.
 */
export function NoDataYet({
  /** Pre-rendered vector icon element. `<EmptyState>` takes the component
   *  instead and sizes it off the icon scale. */
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return <EmptyStateFrame icon={icon} title={title} description={description} action={action} />;
}
