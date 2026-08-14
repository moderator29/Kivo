import { Database } from "lucide-react";

export default function DataHealthPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Data health</h1>
        <p className="text-sm text-foreground-muted">Football data provider status and sync jobs.</p>
      </div>

      <div className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-10 text-center">
        <Database className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
        <p className="max-w-md text-sm text-foreground-muted">
          No football data provider is connected yet. The provider abstraction (
          <code className="text-foreground">FootballDataProvider</code>) and the{" "}
          <code className="text-foreground">sync_runs</code> / <code className="text-foreground">provider_mappings</code>{" "}
          tracking tables are ready — this page will show live sync status, freshness and error rates the moment
          <code className="text-foreground"> API_FOOTBALL_KEY</code> is set and a sync job runs.
        </p>
      </div>
    </div>
  );
}
