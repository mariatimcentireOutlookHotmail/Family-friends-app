import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { Language } from "@/i18n/languages";

import type { TreeRole } from "./people";
import { supabase } from "./supabase";

/**
 * Stories and memorial profiles. The database decides who may read, write,
 * edit and delete (supabase/migrations/20261121020000_stories_memorials.sql);
 * the helpers here only decide which buttons to show.
 */

export type Story = {
  id: string;
  person_id: string;
  tree_id: string;
  title: string | null;
  body: string;
  lang: Language;
  author: string | null;
  created_at: string;
  updated_at: string;
};

export type Memorial = { on: boolean; stewards: string[] };

const storiesKey = (personId: string) => ["stories", personId] as const;
const memorialKey = (personId: string) => ["memorial", personId] as const;

export function useStories(personId: string) {
  return useQuery({
    queryKey: storiesKey(personId),
    queryFn: async (): Promise<Story[]> => {
      const { data, error } = await supabase
        .from("stories")
        .select("id, person_id, tree_id, title, body, lang, author, created_at, updated_at")
        .eq("person_id", personId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Story[];
    },
  });
}

export function useMemorial(personId: string) {
  return useQuery({
    queryKey: memorialKey(personId),
    queryFn: async (): Promise<Memorial> => {
      const { data, error } = await supabase
        .from("memorials")
        .select("person_id, memorial_stewards(user_id)")
        .eq("person_id", personId)
        .maybeSingle();
      if (error) throw error;
      const row = data as { memorial_stewards: { user_id: string }[] } | null;
      return { on: Boolean(row), stewards: row?.memorial_stewards.map((s) => s.user_id) ?? [] };
    },
  });
}

export type StoryInput = { id?: string; personId: string; treeId: string; title: string; body: string; lang: Language };

export function useSaveStory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: StoryInput & { author: string | undefined }) => {
      const fields = { title: input.title.trim() || null, body: input.body.trim(), lang: input.lang };
      if (input.id) {
        const { error, count } = await supabase.from("stories").update(fields, { count: "exact" }).eq("id", input.id);
        if (error) throw error;
        if (count === 0) throw new Error("not allowed");
      } else {
        const { error } = await supabase
          .from("stories")
          .insert({ ...fields, person_id: input.personId, tree_id: input.treeId, author: input.author });
        if (error) throw error;
      }
    },
    onSuccess: (_d, input) => {
      void queryClient.invalidateQueries({ queryKey: storiesKey(input.personId) });
      void queryClient.invalidateQueries({ queryKey: ["history"] });
    },
  });
}

export function useDeleteStory(personId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (storyId: string) => {
      const { error, count } = await supabase.from("stories").delete({ count: "exact" }).eq("id", storyId);
      if (error) throw error;
      if (count === 0) throw new Error("not allowed");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: storiesKey(personId) });
      void queryClient.invalidateQueries({ queryKey: ["history"] });
    },
  });
}

export function useSetMemorial(personId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ on, stewards }: { on: boolean; stewards: string[] }) => {
      const { error } = await supabase.rpc("set_memorial", { p_person: personId, p_on: on, p_stewards: stewards });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: memorialKey(personId) });
      void queryClient.invalidateQueries({ queryKey: ["history"] });
    },
  });
}

export type MemberName = { user_id: string; role: TreeRole; name: string | null };

/** Members of a tree with their own profile's name (owners only). */
export function useTreeMemberNames(treeId: string | undefined) {
  return useQuery({
    queryKey: ["tree-members", treeId],
    enabled: Boolean(treeId),
    queryFn: async (): Promise<MemberName[]> => {
      const { data, error } = await supabase.rpc("tree_member_names", { p_tree: treeId });
      if (error) throw error;
      return (data ?? []) as MemberName[];
    },
  });
}

type PersonForStories = {
  myRole: TreeRole | null;
  claimed_by_user_id: string | null;
  living_status: string;
  my_access?: { hiddenMinor?: boolean } | null;
};

/** Which story buttons to show (the database checks again). */
export function storyPermissions(person: PersonForStories, memorial: Memorial | undefined, userId: string | undefined) {
  const isMemorial = Boolean(memorial?.on) && person.living_status === "deceased";
  const isSteward = isMemorial && !!userId && (memorial?.stewards.includes(userId) ?? false);
  const isClaimant = !!userId && person.claimed_by_user_id === userId;
  const editorOrOwner = person.myRole === "owner" || person.myRole === "editor";
  const hidden = person.my_access?.hiddenMinor ?? false;
  return {
    isMemorial,
    isSteward,
    canWrite: !hidden && (editorOrOwner || isClaimant || (isMemorial && person.myRole !== null)),
    canEdit: (story: Pick<Story, "author">) => !!userId && (story.author === userId || isSteward),
    canDelete: (story: Pick<Story, "author">) =>
      !!userId && (story.author === userId || isSteward || isClaimant || person.myRole === "owner"),
    canSetUpMemorial: person.myRole === "owner" && person.living_status === "deceased",
  };
}
