import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";

/**
 * Values come from .env (git-ignored). EXPO_PUBLIC_ values are bundled into
 * the app, so ONLY the project URL and the public key may be used here, never
 * the service_role / secret key.
 *
 * Supabase calls the public key the "publishable key" (newer projects) or the
 * "anon key" (older ones). Either name works.
 */
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** False when .env is missing or incomplete; the app then shows a notice. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabaseConfig = {
  url: supabaseUrl ?? "",
  key: supabaseKey ?? "",
};

export const supabase = createClient(
  // Placeholders keep the app from crashing before .env is set up.
  supabaseUrl || "https://not-configured.supabase.co",
  supabaseKey || "not-configured",
  {
    auth: {
      // Keeps people signed in between app launches (all platforms).
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // Only the web build can receive a sign-in session through the URL.
      detectSessionInUrl: Platform.OS === "web",
    },
  },
);

// On phones, only refresh the sign-in token while the app is open; Supabase
// recommends this so sessions stay valid without work in the background.
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
