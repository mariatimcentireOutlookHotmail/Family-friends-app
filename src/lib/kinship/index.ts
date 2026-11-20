import type { Language } from "@/i18n/languages";

import { describeEn, termEn } from "./en";
import { describeId, termId } from "./id";
import { KinGraph, type KinLink, type KinPath, type KinPerson } from "./path";
import { describeZhHans, termZhHans } from "./zhHans";

export { KinGraph, type KinLink, type KinPath, type KinPerson } from "./path";

/**
 * One function per language turns a path into a word and a plain description.
 * A new language needs only a new file like ./en.ts, added here.
 */
const LANGUAGES: Record<Language, { term: (p: KinPath) => string | null; describe: (p: KinPath) => string }> = {
  en: { term: termEn, describe: describeEn },
  id: { term: termId, describe: describeId },
  "zh-Hans": { term: termZhHans, describe: describeZhHans },
};

export type KinLabel = {
  /** The kinship word ("uncle", "paman", "伯父"), or null if there isn't one. */
  term: string | null;
  /** Always present: "father's elder brother", "kakak laki-laki dari ayah", "父亲的哥哥". */
  description: string;
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function labelFor(path: KinPath, language: Language): KinLabel {
  const lang = LANGUAGES[language];
  const term = lang.term(path);
  return {
    term: term ? capitalize(term) : null,
    description: capitalize(lang.describe(path)),
  };
}

/**
 * Labels for everyone in a tree, seen from ego (the viewer's own profile).
 * Returns an empty map if the viewer has no profile in the tree.
 */
export function labelsForTree(
  egoId: string | null,
  people: KinPerson[],
  links: KinLink[],
  language: Language,
): Map<string, KinLabel> {
  const labels = new Map<string, KinLabel>();
  if (!egoId) return labels;
  const graph = new KinGraph(people, links);
  for (const person of people) {
    const path = graph.findPath(egoId, person.id);
    if (path) labels.set(person.id, labelFor(path, language));
  }
  return labels;
}
