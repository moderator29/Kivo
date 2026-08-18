import type { Metadata } from "next";
import { getPopularTeams, searchPlatform } from "@/app/(app)/search-actions";
import { SearchSurface } from "@/components/search/search-surface";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Search" };

/**
 * Search's own page, and the reason the top bar no longer carries a field.
 *
 * `?q=` is honoured server-side so a shared or bookmarked search renders its
 * results in the first paint rather than after a client round trip — the
 * client surface takes over from there for everything typed afterwards.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const initialQuery = (q ?? "").slice(0, 80);

  const [{ results, error }, popularTeams] = await Promise.all([
    initialQuery.trim().length >= 2
      ? searchPlatform(initialQuery)
      : Promise.resolve({ results: [], error: null as string | null }),
    getPopularTeams(),
  ]);

  return (
    <div className="kivo-page">
      <PageHeader title="Search" description="Everything KIVO has synced — clubs, players, competitions, managers and venues." />
      <SearchSurface
        initialQuery={initialQuery}
        initialResults={results}
        initialError={error}
        popularTeams={popularTeams}
      />
    </div>
  );
}
