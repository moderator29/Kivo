import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";

/**
 * Uptime-monitor target (RECOMMENDATIONS.md item 214). No auth, no
 * side effects — a single cheap read to confirm the app can actually reach
 * Supabase, not just that the process is up. Uses the service-role client
 * so the result reflects real connectivity rather than depending on a given
 * table having a public RLS policy.
 */
export async function GET() {
  const supabase = createServiceRoleSupabaseClient();
  const { error } = await supabase.from("competitions").select("id").limit(1);

  const status = error ? "unhealthy" : "healthy";
  const body = {
    status,
    timestamp: new Date().toISOString(),
    checks: {
      database: error ? "unreachable" : "ok",
    },
  };

  return NextResponse.json(body, { status: error ? 503 : 200 });
}
