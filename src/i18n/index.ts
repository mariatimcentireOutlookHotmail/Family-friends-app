import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import i18n from "i18next";
import ICU from "i18next-icu";
import { initReactI18next } from "react-i18next";
import { Platform } from "react-native";

import {
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  matchLanguage,
  SUPPORTED_LANGUAGES,
  type Language,
} from "./languages";
import { DEFAULT_NAMESPACE, NAMESPACES, resources } from "./resources";

/** Where the user's explicit choice is saved on this device. */
const STORAGE_KEY = "settings.language";

/** First supported language in the device's preference list, else English. */
export function getDeviceLanguage(): Language {
  for (const locale of getLocales()) {
    const match = matchLanguage(locale.languageTag);
    if (match) return match;
  }
  return DEFAULT_LANGUAGE;
}

function syncWebDocumentLang(lng: string) {
  // Lets the browser pick suitable fonts (e.g. CJK) and helps screen readers.
  if (Platform.OS === "web" && typeof document !== "undefined") {
    document.documentElement.lang = lng;
  }
}

i18n
  .use(ICU) // ICU message syntax for plurals, e.g. {count, plural, ...}
  .use(initReactI18next)
  .init({
    resources,
    lng: getDeviceLanguage(),
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    load: "currentOnly", // don't try "zh" for "zh-Hans"
    ns: [...NAMESPACES],
    defaultNS: DEFAULT_NAMESPACE,
    interpolation: { escapeValue: false }, // React already escapes
    returnNull: false,
    initAsync: false, // resources are bundled, so init synchronously
  });

i18n.on("languageChanged", syncWebDocumentLang);
syncWebDocumentLang(i18n.language);

/**
 * Apply the language saved on this device, if any. Call once at startup.
 * (Later, once accounts exist, the user's saved locale should win.)
 */
export async function loadSavedLanguage(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (isSupportedLanguage(saved) && saved !== i18n.language) {
      await i18n.changeLanguage(saved);
    }
  } catch {
    // Storage unavailable: keep the device language.
  }
}

/** The user's explicit choice, or null if following the device language. */
export async function getSavedLanguage(): Promise<Language | null> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    return isSupportedLanguage(saved) ? saved : null;
  } catch {
    return null;
  }
}

/** Switch language. Pass null to go back to following the device language. */
export async function setLanguage(lng: Language | null): Promise<void> {
  const next = lng ?? getDeviceLanguage();
  await i18n.changeLanguage(next);
  try {
    if (lng) await AsyncStorage.setItem(STORAGE_KEY, lng);
    else await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not fatal: the language still changes for this session.
  }
}

export default i18n;
