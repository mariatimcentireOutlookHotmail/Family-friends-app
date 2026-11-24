import type { PersonName } from "./trees";

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

// -----------------------------------------------------------------------------
// Which name to show
// -----------------------------------------------------------------------------

type HasNames = { person_names: Pick<PersonName, "full_display" | "is_primary" | "type">[] };

/** The name to show for a person: their main name, or the first one. */
export function primaryName(person: HasNames): string | null {
  const names = person.person_names ?? [];
  return (names.find((n) => n.is_primary) ?? names[0])?.full_display ?? null;
}

/** "Also known as" names, e.g. the English name of a Chinese person. */
/** The person's nickname, if they have one (the first, if several). */
export function nickname(person: HasNames): string | null {
  return (person.person_names ?? []).find((n) => n.type === "nickname" && !n.is_primary)?.full_display ?? null;
}

export function akaNames(person: HasNames): string[] {
  return (person.person_names ?? [])
    .filter((n) => !n.is_primary && n.type === "aka")
    .map((n) => n.full_display);
}

/**
 * The other name family members call someone, if any: their nickname, or
 * else their first "also known as" name (often an English name next to a
 * Chinese one). Null when they only go by their main name.
 */
export function knownAs(person: HasNames): string | null {
  const name = nickname(person) ?? akaNames(person)[0] ?? null;
  return name && name !== primaryName(person) ? name : null;
}

/**
 * The name family members know someone by: their nickname or "also known
 * as" name if they have one, otherwise their main name. Used on the tree, in
 * lists and for relatives; the person's own page keeps the main name as its
 * title.
 */
export function everydayName(person: HasNames): string | null {
  return knownAs(person) ?? primaryName(person);
}
