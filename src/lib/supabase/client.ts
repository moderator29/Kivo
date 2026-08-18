"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useMemo } from "react";
import type { Database } from "./types";

/**
 * Browser-side Supabase client. Reads the same `sb-<ref>-auth-token` cookies
 * the server client writes, so a realtime subscription or client-side query
 * runs as the same signed-in user and hits the same RLS policies whichever
 * side issued it.
 *
 * `createBrowserClient` is itself a singleton internally — calling it again
 * returns the same underlying client — so the `useMemo` here is only about not
 * re-running the factory on every render, not about identity.
 */
export function useSupabaseClient() {
  return useMemo(
    () =>
      createBrowserClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      ),
    [],
  );
}
