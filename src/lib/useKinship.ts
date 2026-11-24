import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { DEFAULT_LANGUAGE, isSupportedLanguage } from "@/i18n/languages";

import { useAuth } from "./auth";
import { labelsForTree, type KinLabel, type KinPerson } from "./kinship";
import type { Tree } from "./trees";

/**
 * Kinship labels for everyone in a tree, from the signed-in user's own profile
 * in that tree, in the current language. Worked out on the device each time;
 * never stored. Empty when the user has no profile in the tree.
 */
export function useKinship(tree: Tree | undefined): Map<string, KinLabel> {
  const { session } = useAuth();
  const { i18n } = useTranslation();
  const language = isSupportedLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;
  const userId = session?.user.id;

  return useMemo(() => {
    if (!tree) return new Map();
    const ego = tree.persons.find((p) => p.claimed_by_user_id === userId)?.id ?? null;
    const people: KinPerson[] = tree.persons.map((p) => ({
      id: p.id,
      sex: p.sex,
      birthYear: p.events?.find((e) => e.type === "birth")?.year ?? null,
      birthOrder: p.birth_order,
    }));
    return labelsForTree(ego, people, tree.relationships ?? [], language);
  }, [tree, userId, language]);
}

/** "Uncle · Father's elder brother", or just the description if there's no word. */
export function labelText(label: KinLabel | undefined): string | null {
  if (!label) return null;
  // English often has the same word for both ("Mother · Mother"): say it once.
  if (!label.term || label.term.toLowerCase() === label.description.toLowerCase()) return label.description;
  return `${label.term} · ${label.description}`;
}
