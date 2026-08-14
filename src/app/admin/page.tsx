import { Users, MessageSquare, ShieldAlert, Radio } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";

async function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: number | string;
}) {
  return (
    <div className="kivo-glass flex flex-col gap-2 rounded-2xl p-5">
      <Icon className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
      <span className="text-2xl font-semibold text-foreground">{value}</span>
      <span className="text-xs font-medium text-foreground-subtle">{label}</span>
    </div>
  );
}

export default async function AdminOverviewPage() {
  const supabase = createServerSupabaseClient();

  const [{ count: userCount }, { count: postCount }, { count: pendingReportCount }] = await Promise.all([
    supabase.from("profiles").select("*", { count: "exact", head: true }),
    supabase.from("posts").select("*", { count: "exact", head: true }),
    supabase.from("reports").select("*", { count: "exact", head: true }).eq("status", "pending"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Platform overview</h1>
        <p className="text-sm text-foreground-muted">What&apos;s happening on KIVO right now.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Users} label="Total users" value={userCount ?? 0} />
        <StatCard icon={MessageSquare} label="Total posts" value={postCount ?? 0} />
        <StatCard icon={ShieldAlert} label="Pending reports" value={pendingReportCount ?? 0} />
        <StatCard icon={Radio} label="Football data providers live" value={0} />
      </div>

      <div className="kivo-glass rounded-2xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">System status</h2>
        <p className="mt-2 text-sm text-foreground-muted">
          No football data provider is connected yet (API-Football free tier is architected but not enabled — see
          Data health). AI Copilot, notifications and fantasy scoring are not yet live. Social is fully operational.
        </p>
      </div>
    </div>
  );
}
