import { getSavedLanguage, setLanguage } from "@/i18n";
import { isSupportedLanguage, type Language } from "@/i18n/languages";

import { supabase } from "./supabase";

/**
 * After sign-in: if the account has a saved language, use it on this device.
 * If not, but this device has an explicit choice, save that to the account.
 */
export async function syncLanguageWithProfile(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from("profiles")
    .select("locale")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return;

  if (isSupportedLanguage(data.locale)) {
    await setLanguage(data.locale);
    return;
  }
  const deviceChoice = await getSavedLanguage();
  if (deviceChoice) await saveLanguageToProfile(userId, deviceChoice);
}

/** Save the language to the account. null = follow the device language. */
export async function saveLanguageToProfile(userId: string, lng: Language | null): Promise<void> {
  await supabase.from("profiles").update({ locale: lng }).eq("id", userId);
}
