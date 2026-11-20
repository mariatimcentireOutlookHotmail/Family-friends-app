import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { Language } from "@/i18n/languages";

import type { PartialDate } from "./dates";

import { useAuth } from "./auth";
import { supabase } from "./supabase";

export type Sex = "female" | "male" | "other" | "unknown";
export type NameType = "birth" | "aka" | "married" | "nickname" | "religious" | "other";

export type PersonName = {
  /** Only loaded where needed (e.g. for editing). */
  given?: string | null;
  family?: string | null;
  full_display: string;
  is_primary: boolean;
  script: string | null;
  type: NameType;
};

export type TreePerson = {
  id: string;
  claimed_by_user_id: string | null;
  sex: Sex;
  birth_order: number | null;
  person_names: PersonName[];
  /** Birth/death years only (enough for ages and older/younger). */
  events: { type: "birth" | "death"; year: number | null }[];
};

export type TreeLink = {
  type: "parent" | "partner" | "sibling" | "friend";
  subtype: string | null;
  person_a: string;
  person_b: string;
};

export type Tree = {
  id: string;
  name: string;
  default_locale: Language;
  persons: TreePerson[];
  relationships: TreeLink[];
};

/** Query key for the signed-in user's trees; use it to refresh after changes. */
export const myTreesKey = (userId: string | undefined) => ["my-trees", userId] as const;

/**
 * Trees the signed-in user belongs to, with their people and names.
 * The database rules (RLS) make sure only the user's own trees come back.
 */
export function useMyTrees() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: myTreesKey(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<Tree[]> => {
      const { data, error } = await supabase
        .from("trees")
        .select(
          `id, name, default_locale,
           persons(id, claimed_by_user_id, sex, birth_order,
                   person_names(full_display, is_primary, script, type), events(type, year)),
           relationships(type, subtype, person_a, person_b)`,
        )
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Tree[];
    },
  });
}

export type NewName = {
  given: string | null;
  family: string | null;
  full_display: string;
  script: string | null;
  lang: string | null;
  type: NameType;
};

export type CreateTreeInput = {
  treeName: string;
  treeLocale: Language;
  names: NewName[]; // the first is the main name
  sex: Sex;
  birth: PartialDate | null;
};

/** Creates a tree with the signed-in user as its first person (one database call). */
export function useCreateTree() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTreeInput): Promise<string> => {
      const { data, error } = await supabase.rpc("create_tree_with_me", {
        p_tree_name: input.treeName,
        p_tree_locale: input.treeLocale,
        p_names: input.names,
        p_sex: input.sex,
        p_birth: input.birth,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: myTreesKey(session?.user.id) }),
  });
}

type HasNames = { person_names: PersonName[] };

/** The name to show for a person: their main name, or the first one. */
export function primaryName(person: HasNames): string | null {
  const names = person.person_names ?? [];
  return (names.find((n) => n.is_primary) ?? names[0])?.full_display ?? null;
}

/** "Also known as" names, e.g. the English name of a Chinese person. */
export function akaNames(person: HasNames): string[] {
  return (person.person_names ?? [])
    .filter((n) => !n.is_primary && n.type === "aka")
    .map((n) => n.full_display);
}
