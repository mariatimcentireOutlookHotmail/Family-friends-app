/**
 * Personal-name helpers. Names are stored in parts (given, family, ...) plus a
 * ready-to-show `full_display`. The display order follows the NAME's own
 * culture, not the app language: Chinese names are family name first, with no
 * space (陈美玲), while Latin-script names default to given name first
 * (Mei Ling Tan) but can be switched (Tan Mei Ling).
 */

/** ISO 15924 codes we detect. "Hani" = Han characters (Chinese). */
export type NameScript = "Latn" | "Hani";

// Explicit ranges instead of \p{Script=...}, which not every JS engine supports.
const HAN = /[㐀-䶿一-鿿豈-﫿]/;
const LATIN = /[A-Za-zÀ-ɏḀ-ỿ]/;

/** Which script a name is written in, from its characters. */
export function detectScript(...parts: (string | null | undefined)[]): NameScript | null {
  const text = parts.filter(Boolean).join("");
  if (HAN.test(text)) return "Hani";
  if (LATIN.test(text)) return "Latn";
  return null;
}

/** Whether a name in this script is usually written family name first. */
export function isFamilyFirstByDefault(script: NameScript | null): boolean {
  return script === "Hani";
}

/** Language tag to store with a name, when the script makes it clear. */
export function guessNameLang(script: NameScript | null): string | null {
  return script === "Hani" ? "zh" : null;
}

export type NameParts = {
  given: string;
  family: string;
  familyFirst: boolean;
};

/** The name as it should be shown, e.g. "陈美玲", "Mei Ling Tan", "Sukarno". */
export function formatFullName({ given, family, familyFirst }: NameParts): string {
  const g = given.trim().replace(/\s+/g, " ");
  const f = family.trim().replace(/\s+/g, " ");
  if (!f) return g;
  if (!g) return f;
  const script = detectScript(g, f);
  if (familyFirst) {
    // Chinese characters are written together without a space.
    return script === "Hani" ? `${f}${g}` : `${f} ${g}`;
  }
  return `${g} ${f}`;
}

/**
 * A saved name → editable parts, including whether it was shown family name
 * first. Old entries with only a full name keep it all in "given".
 */
export function splitSavedName(name: {
  given?: string | null;
  family?: string | null;
  full_display: string;
}): NameParts {
  const given = name.given ?? "";
  const family = name.family ?? "";
  if (!given && !family) return { given: name.full_display, family: "", familyFirst: false };
  if (!given || !family) return { given, family, familyFirst: isFamilyFirstByDefault(detectScript(given, family)) };
  const familyFirst = formatFullName({ given, family, familyFirst: true }) === name.full_display;
  return { given, family, familyFirst };
}
