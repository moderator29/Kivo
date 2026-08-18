import { Users, MessageSquare, ShieldAlert, Radio } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { canViewModerationData, canViewUserData } from "@/lib/admin";
import { getActiveProviderStatus } from "@/lib/football";
import { FadeIn } from "@/components/ui/fade-in";

function StatCard({
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
  const profile = await getOrCreateProfile();
  const supabase = createServerSupabaseClient();
  const canSeeUsers = canViewUserData(profile?.role);
  const canSeeReports = canViewModerationData(profile?.role);
  // Same env-var selection order as Data Health's own provider banner — see
  // getActiveProviderStatus() in src/lib/football/index.ts. Kept as a shared
  // helper specifically so this card can't drift out of sync with what Data
  // Health actually reports.
  const providerStatus = getActiveProviderStatus();

  // Posts are publicly readable, so that count is real for every admin role.
  // Users/reports are RLS-gated to specific roles — querying them for a role
  // that can't see the rows would silently return 0, which reads as "there
  // are none" rather than "you can't see this." Show "—" instead.
  const [{ count: postCount }, userCount, pendingReportCount] = await Promise.all([
    supabase.from("posts").select("*", { count: "exact", head: true }),
    canSeeUsers
      ? supabase.from("profiles").select("*", { count: "exact", head: true }).then((r) => r.count)
      : Promise.resolve(null),
    canSeeReports
      ? supabase
          .from("reports")
          .select("*", { count: "exact", head: true })
          .eq("status", "pending")
          .then((r) => r.count)
      : Promise.resolve(null),
  ]);

  const stats = [
    { icon: Users, label: "Total users", value: canSeeUsers ? (userCount ?? 0) : "-" },
    { icon: MessageSquare, label: "Total posts", value: postCount ?? 0 },
    { icon: ShieldAlert, label: "Pending reports", value: canSeeReports ? (pendingReportCount ?? 0) : "-" },
    { icon: Radio, label: "Football data provider", value: providerStatus.name ? "Live" : "Off" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <FadeIn>
        <h1 className="text-xl font-semibold text-foreground">Platform overview</h1>
        <p className="text-sm text-foreground-muted">What&apos;s happening on KIVO right now.</p>
      </FadeIn>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat, index) => (
          <FadeIn key={stat.label} delay={0.08 + index * 0.05}>
            <StatCard icon={stat.icon} label={stat.label} value={stat.value} />
          </FadeIn>
        ))}
      </div>

      <FadeIn delay={0.32} className="kivo-glass-brand rounded-2xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">System status</h2>
        <p className="mt-2 text-sm text-foreground-muted">
          {providerStatus.name
            ? `${providerStatus.label} is connected — sync jobs on Data health pull real fixtures.`
            : "No football data provider is connected yet (see Data health to configure one)."}{" "}
          Social, fantasy (including live scoring), predictions and notifications are all live. AI Copilot is still
          in development.
        </p>
      </FadeIn>
    </div>
  );
}
