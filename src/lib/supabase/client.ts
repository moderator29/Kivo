"use client";

import { useSession } from "@clerk/nextjs";
import { createClient } from "@supabase/supabase-js";
import { useMemo } from "react";
import type { Database } from "./types";

/**
 * Browser-side Supabase client authorized via the active Clerk session.
 * Mirrors the server client's accessToken pattern so RLS behaves
 * identically whichever side issued the query.
 */
export function useSupabaseClient() {
  const { session } = useSession();

  return useMemo(
    () =>
      createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        async accessToken() {
          return session?.getToken() ?? null;
        },
      }),
    [session],
  );
}
