// src/supabaseClient.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Export a nullable client so the app can still render even if env vars are missing.
export const supabase: SupabaseClient | null = (() => {
  if (!url || !anon) {
    console.warn("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY (Supabase disabled).");
    return null;
  }
  try {
    return createClient(url, anon);
  } catch (e) {
    console.warn("Failed to create Supabase client (Supabase disabled).", e);
    return null;
  }
})();
