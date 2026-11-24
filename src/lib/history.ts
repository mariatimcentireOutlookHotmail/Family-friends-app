import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "./auth";
import type { HistoryGroup } from "./historySummary";
import { isPostgrestError } from "./postgrestError";
import { supabase } from "./supabase";
import { myTreesKey } from "./trees";

/**
 * The change log ("History"). The database decides what each viewer may see
 * (supabase/migrations/20261120100000_change_log.sql).
 */

const PAGE = 30;
export const historyKey = (treeId: string, personId: string | null) => ["history", treeId, personId] as const;

/** Newest first, PAGE groups at a time ("Show more" loads older ones). */
export function useHistory(treeId: string, personId: string | null) {
  return useInfiniteQuery({
    queryKey: historyKey(treeId, personId),
    initialPageParam: null as number | null,
    queryFn: async ({ pageParam }): Promise<HistoryGroup[]> => {
      const { data, error } = await supabase.rpc("tree_history", {
        p_tree: treeId,
        p_person: personId,
        p_before: pageParam,
        p_limit: PAGE,
      });
      if (error) throw error;
      return (data ?? []) as HistoryGroup[];
    },
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1]!.txid : undefined),
  });
}

export type UndoErrorKey = "notAllowed" | "conflict" | "claimed" | "alreadyUndone" | "failed";

export function undoErrorKey(error: unknown): UndoErrorKey {
  if (!isPostgrestError(error)) return "failed";
  switch (error.hint) {
    case "history_not_allowed":
      return "notAllowed";
    case "history_conflict":
      return "conflict";
    case "history_claimed":
      return "claimed";
    case "history_already_undone":
      return "alreadyUndone";
    default:
      return "failed";
  }
}

export function useUndoChange(treeId: string) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (txid: number) => {
      const { error } = await supabase.rpc("undo_change", { p_tree: treeId, p_txid: txid });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["history", treeId] });
      void queryClient.invalidateQueries({ queryKey: myTreesKey(session?.user.id) });
      void queryClient.invalidateQueries({ queryKey: ["person"] });
      void queryClient.invalidateQueries({ queryKey: ["link"] });
    },
  });
}
