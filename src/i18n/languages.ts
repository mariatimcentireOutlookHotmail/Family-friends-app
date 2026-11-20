/**
 * Supported languages. To add a language later: add its code here, add a
 * folder under ./locales with the same files as ./locales/en, and register it
 * in ./resources.ts. (A kinship-label function will also be needed later.)
 */
export const SUPPORTED_LANGUAGES = ["en", "id", "zh-Hans"] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = "en";

/**
 * Each language's name written in that language (its autonym). These are the
 * one intentional exception to "no hard-coded UI text": a language's own name
 * must look the same whatever the current UI language is, so people can find
 * their language even if they can't read the current one.
 */
export const LANGUAGE_AUTONYMS: Record<Language, string> = {
  en: "English",
  id: "Bahasa Indonesia",
  "zh-Hans": "简体中文",
};

export function isSupportedLanguage(value: unknown): value is Language {
  return (
    typeof value === "string" &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  );
}

/**
 * Map a BCP 47 tag from the device (e.g. "id-ID", "zh-Hans-CN", "zh-TW",
 * "en-US") to the closest supported language.
 */
export function matchLanguage(tag: string | null | undefined): Language | null {
  if (!tag) return null;
  const lower = tag.toLowerCase();
  if (lower === "id" || lower.startsWith("id-") || lower.startsWith("in-") || lower === "in") {
    return "id";
  }
  // Only Simplified Chinese ships for now, so every Chinese variant maps to it.
  if (lower === "zh" || lower.startsWith("zh-")) return "zh-Hans";
  if (lower === "en" || lower.startsWith("en-")) return "en";
  return null;
}
