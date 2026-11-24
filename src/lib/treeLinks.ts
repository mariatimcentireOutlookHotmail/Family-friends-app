import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { Language } from "@/i18n/languages";

import type { InvitePreview } from "./invites";
import { isPostgrestError } from "./postgrestError";
import { supabase } from "./supabase";

/**
 * Linked trees: the same person in two families' trees. The database does
 * every check (supabase/migrations/20261120110000_tree_links.sql).
 */

/** A person as the other family shows them: names and years only. */
export type LinkedCard = {
  id: string;
  sex: "female" | "male" | "other" | "unknown";
  living: "living" | "deceased" | "unknown";
  name: string | null;
  nickname: string | null;
  birthYear: number | null;
  deathYear: number | null;
};

export type FamilyRelation = "parent" | "child" | "partner" | "sibling";

export type PersonLink = {
  linkId: string;
  treeName: string;
  person: LinkedCard | null;
  family: (LinkedCard & { relation: FamilyRelation })[];
  canUnlink: boolean;
};

export type LinkPreview = {
  kind: "link";
  status: "ok";
  treeId: string;
  treeName: string;
  person: LinkedCard | null;
  requesterName: string | null;
  myTrees: { id: string; name: string }[];
};

/** What a typed code is: an invite, a link request, or nothing. */
export type CodePreview =
  | ({ kind: "invite" } & InvitePreview)
  | LinkPreview
  | { kind: "invalid"; status: "invalid" };

export type LinkErrorKey = "notAllowed" | "sameTree" | "minor" | "exists";

export function linkErrorKey(error: unknown): LinkErrorKey | null {
  if (!isPostgrestError(error)) return null;
  switch (error.hint) {
    case "link_not_allowed":
      return "notAllowed";
    case "link_same_tree":
      return "sameTree";
    case "link_minor":
      return "minor";
    case "link_exists":
      return "exists";
    default:
      return null;
  }
}

const linksKey = (personId: string) => ["person-links", personId] as const;
const pendingKey = (personId: string) => ["link-code", personId] as const;

export function usePersonLinks(personId: string) {
  return useQuery({
    queryKey: linksKey(personId),
    queryFn: async (): Promise<PersonLink[]> => {
      const { data, error } = await supabase.rpc("person_links", { p_person: personId });
      if (error) throw error;
      return (data ?? []) as PersonLink[];
    },
  });
}

export function usePendingLinkCode(personId: string, enabled: boolean) {
  return useQuery({
    queryKey: pendingKey(personId),
    enabled,
    queryFn: async (): Promise<{ id: string; createdAt: string; expiresAt: string } | null> => {
      const { data, error } = await supabase.rpc("pending_link_code", { p_person: personId });
      if (error) throw error;
      return (data ?? null) as { id: string; createdAt: string; expiresAt: string } | null;
    },
  });
}

export function useCreateLinkCode(personId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (lang: Language): Promise<string> => {
      const { data, error } = await supabase.rpc("create_link_code", { p_person: personId, p_lang: lang });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: pendingKey(personId) }),
  });
}

export function useRevokeLinkCode(personId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase.rpc("revoke_link_code", { p_request: requestId });
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: pendingKey(personId) }),
  });
}

export function useUnlink(personId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (linkId: string) => {
      const { error } = await supabase.rpc("unlink_trees", { p_link: linkId });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: linksKey(personId) });
      void queryClient.invalidateQueries({ queryKey: ["history"] });
    },
  });
}

export function useCodePreview() {
  return useMutation({
    mutationFn: async (code: string): Promise<CodePreview> => {
      const { data, error } = await supabase.rpc("code_preview", { p_code: code });
      if (error) throw error;
      return data as CodePreview;
    },
  });
}

class InvalidLinkCodeError extends Error {}
export const isInvalidLinkCode = (e: unknown) => e instanceof InvalidLinkCodeError;

/** Link the code's person with one of yours; resolves to your person's id. */
export function useAcceptLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ code, personId }: { code: string; personId: string }): Promise<string> => {
      const { data, error } = await supabase.rpc("accept_link", { p_code: code, p_person: personId });
      if (error) throw error;
      if (!data) throw new InvalidLinkCodeError();
      return personId;
    },
    onSuccess: (personId) => {
      void queryClient.invalidateQueries({ queryKey: linksKey(personId) });
      void queryClient.invalidateQueries({ queryKey: ["history"] });
    },
  });
}

/** "Mother", "Son", "Partner" — the key under "relation" in the links translations. */
export function relationKey(relation: FamilyRelation, sex: LinkedCard["sex"]): string {
  const gendered: Record<FamilyRelation, [string, string, string]> = {
    parent: ["father", "mother", "parent"],
    child: ["son", "daughter", "child"],
    partner: ["husband", "wife", "partner"],
    sibling: ["brother", "sister", "sibling"],
  };
  const [m, f, n] = gendered[relation];
  return sex === "male" ? m : sex === "female" ? f : n;
}
