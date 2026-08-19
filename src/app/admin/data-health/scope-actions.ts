"use server";

import { revalidatePath } from "next/cache";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getActiveProviderStatus } from "@/lib/football";
import { logError } from "@/lib/log";

/**
 * Adding and removing the competitions KIVO covers.
 *
 * Neither action takes a league id from a text box, and that is the entire
 * point. `addCompetitionToScope` takes an id that came out of
 * `provider_coverage` — the provider's own registry — and re-reads that row to
 * copy the name and country across. An id that is not in the registry is
 * refused with a sentence saying so, rather than being written and left to
 * silently sync a competition nobody chose.
 *
 * Both cost 0 provider requests: the registry was already bought by one
 * `/leagues` call.
 */

async function requireAdmin(): Promise<{ error: string } | null> {
  const profile = await getOrCreateProfile();
  if (!profile || !canManageFootballData(profile.role)) {
    return { error: "You don't have football data admin access." };
  }
  return null;
}

export type ScopeMutationResult = { error: string | null; label?: string | null };

export async function addCompetitionToScope(providerCompetitionId: string): Promise<ScopeMutationResult> {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { name: providerName } = getActiveProviderStatus();
  if (!providerName) return { error: "No football data provider is configured." };

  const supabase = createServiceRoleSupabaseClient();

  // The registry is the authority on what this id is. Reading it back here is
  // what makes "nobody types an id" true rather than aspirational: an id with
  // no registry row cannot be added at all.
  const { data: registry, error: registryError } = await supabase
    .from("provider_coverage")
    .select("competition_name, country")
    .eq("provider", providerName)
    .eq("provider_competition_id", providerCompetitionId)
    .limit(1)
    .maybeSingle();

  if (registryError) {
    logError("admin.addCompetitionToScope.registry", registryError);
    return { error: "Couldn't read the coverage registry." };
  }
  if (!registry) {
    return {
      error: `${providerName} has no competition ${providerCompetitionId} in the coverage registry. Refresh the registry first — an id that isn't in it would sync a competition nobody chose.`,
    };
  }

  // Appended, not inserted at a position: a new competition joins the end of
  // the operator's order rather than silently reordering what is already there.
  const { data: last } = await supabase
    .from("competition_scope")
    .select("position")
    .eq("provider", providerName)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("competition_scope").upsert(
    {
      provider: providerName,
      provider_entity_id: providerCompetitionId,
      position: (last?.position ?? -1) + 1,
      label: registry.competition_name,
      country: registry.country,
    },
    { onConflict: "provider,provider_entity_id" },
  );

  if (error) {
    logError("admin.addCompetitionToScope", error);
    return { error: "Couldn't add that competition to the scope." };
  }

  revalidateScopeSurfaces();
  return { error: null, label: registry.competition_name };
}

export async function removeCompetitionFromScope(providerCompetitionId: string): Promise<ScopeMutationResult> {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { name: providerName } = getActiveProviderStatus();
  if (!providerName) return { error: "No football data provider is configured." };

  const supabase = createServiceRoleSupabaseClient();
  const { error } = await supabase
    .from("competition_scope")
    .delete()
    .eq("provider", providerName)
    .eq("provider_entity_id", providerCompetitionId);

  if (error) {
    logError("admin.removeCompetitionFromScope", error);
    return { error: "Couldn't remove that competition from the scope." };
  }

  revalidateScopeSurfaces();
  return { error: null };
}

/** The scope decides what the fixture sync writes AND how the matches list is
 * ordered, so both have to be re-rendered — a panel that changed the scope but
 * left /matches showing the old order would read as the change not working. */
function revalidateScopeSurfaces() {
  revalidatePath("/admin/data-health");
  revalidatePath("/matches");
  revalidatePath("/live");
  revalidatePath("/leagues");
}
