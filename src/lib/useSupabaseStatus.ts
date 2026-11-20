import { useQuery } from "@tanstack/react-query";

import { isSupabaseConfigured, supabaseConfig } from "./supabase";

export type SupabaseStatus =
  | "notConfigured" // .env missing or incomplete
  | "connected" // reached Supabase and the key was accepted
  | "badKey" // reached Supabase but the key was rejected
  | "unreachable"; // network error or wrong URL

/**
 * Checks the connection by calling Supabase Auth's health endpoint.
 * Needs no tables, so it works on a brand-new project.
 */
async function checkConnection(): Promise<SupabaseStatus> {
  if (!isSupabaseConfigured) return "notConfigured";
  try {
    const res = await fetch(`${supabaseConfig.url}/auth/v1/health`, {
      headers: { apikey: supabaseConfig.key },
    });
    if (res.ok) return "connected";
    if (res.status === 401 || res.status === 403) return "badKey";
    return "unreachable";
  } catch {
    return "unreachable";
  }
}

export function useSupabaseStatus() {
  return useQuery({
    queryKey: ["supabase-status"],
    queryFn: checkConnection,
    retry: false,
    staleTime: 60_000,
  });
}
