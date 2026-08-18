import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";

/**
 * Uptime-monitor target (RECOMMENDATIONS.md item 214). No auth, no
 * side effects — a single cheap read to confirm the app can actually reach
 * Supabase, not just that the process is up. Uses the service-role client
 * so the result reflects real connectivity rather than depending on a given
 * table having a public RLS policy.
 *
 * Everything that can fail lives inside the try/catch, including the client
 * construction: `createServiceRoleSupabaseClient()` throws synchronously
 * ("supabaseKey is required.") when SUPABASE_SERVICE_ROLE_KEY is absent, and
 * an endpoint whose entire job is to *report* an outage must not *become*
 * one — an unhandled throw here returns a 500 with a stack trace, so a
 * monitor parsing the documented JSON shape breaks and the alert reads "500"
 * instead of "database unreachable". A missing key means the app genuinely
 * cannot reach Supabase, which is exactly what "unhealthy" is for.
 */
export async function GET() {
  let healthy = false;

  try {
    const supabase = createServiceRoleSupabaseClient();
    const { error } = await supabase.from("competitions").select("id").limit(1);
    if (error) logError("health.databaseCheck", error);
    healthy = !error;
  } catch (error) {
    logError("health.databaseCheck", error);
  }

  const body = {
    status: healthy ? "healthy" : "unhealthy",
    timestamp: new Date().toISOString(),
    checks: {
      database: healthy ? "ok" : "unreachable",
    },
  };

  return NextResponse.json(body, { status: healthy ? 200 : 503 });
}
