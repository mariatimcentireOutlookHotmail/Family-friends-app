import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { Language } from "@/i18n/languages";

import { useAuth } from "./auth";
import type { PersonDetails } from "./people";
import { isPostgrestError } from "./postgrestError";
import { supabase } from "./supabase";
import { myTreesKey } from "./trees";

export { formatCode, isCompleteCode } from "./inviteCodes";

/**
 * Invite-and-claim. The database does all the checks (see
 * supabase/migrations/20261120080000_invites.sql); codes are only ever visible
 * right after they are created.
 */

export type PendingInvite = { id: string; created_at: string; expires_at: string; lang: Language };

export type InvitePreview =
  | { status: "invalid" }
  | {
      status: "ok";
      treeName: string;
      personName: string | null;
      inviterName: string | null;
      expiresAt: string;
      alreadyInTree: boolean;
    };

/** Error keys, under "errors" in the invite translations. */
export type InviteErrorKey =
  | "invalid"
  | "used"
  | "revoked"
  | "expired"
  | "tooManyTries"
  | "alreadyInTree"
  | "notAllowed"
  | "blocked_claimed"
  | "blocked_deceased"
  | "blocked_minor"
  | "failed";

const HINTS: Record<string, InviteErrorKey> = {
  invite_invalid: "invalid",
  invite_used: "used",
  invite_revoked: "revoked",
  invite_expired: "expired",
  invite_too_many_tries: "tooManyTries",
  invite_already_in_tree: "alreadyInTree",
  invite_not_allowed: "notAllowed",
  invite_blocked_claimed: "blocked_claimed",
  invite_blocked_deceased: "blocked_deceased",
  invite_blocked_minor: "blocked_minor",
};

export function inviteErrorKey(error: unknown): InviteErrorKey {
  if (error instanceof InvalidCodeError) return "invalid";
  if (!isPostgrestError(error)) return "failed";
  return (error.hint && HINTS[error.hint]) || "failed";
}

class InvalidCodeError extends Error {}

/** Whether the signed-in user may invite this person (the database checks again). */
export function canInvite(person: PersonDetails): boolean {
  return (
    (person.myRole === "owner" || person.myRole === "editor") &&
    person.claimed_by_user_id === null &&
    person.living_status !== "deceased" &&
    !(person.my_access?.isMinor ?? false)
  );
}

const invitesKey = (personId: string) => ["invites", personId] as const;

/** The person's open invite, if any. */
export function usePendingInvite(personId: string, enabled: boolean) {
  return useQuery({
    queryKey: invitesKey(personId),
    enabled,
    queryFn: async (): Promise<PendingInvite | null> => {
      const { data, error } = await supabase
        .from("invites")
        .select("id, created_at, expires_at, lang")
        .eq("person_id", personId)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as PendingInvite | null;
    },
  });
}

export function useCreateInvite(personId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (lang: Language): Promise<string> => {
      const { data, error } = await supabase.rpc("create_invite", { p_person: personId, p_lang: lang });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: invitesKey(personId) }),
  });
}

export function useRevokeInvite(personId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase.rpc("revoke_invite", { p_invite: inviteId });
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: invitesKey(personId) }),
  });
}

export function usePreviewInvite() {
  return useMutation({
    mutationFn: async (code: string): Promise<InvitePreview> => {
      const { data, error } = await supabase.rpc("invite_preview", { p_code: code });
      if (error) throw error;
      return data as InvitePreview;
    },
  });
}

/** Claims the profile; resolves to the person's id. */
export function useAcceptInvite() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (code: string): Promise<string> => {
      const { data, error } = await supabase.rpc("accept_invite", { p_code: code });
      if (error) throw error;
      if (!data) throw new InvalidCodeError();
      return data as string;
    },
    onSuccess: () => {
      // Don't wait: the screen navigates away right after.
      void queryClient.invalidateQueries({ queryKey: myTreesKey(session?.user.id) });
      void queryClient.invalidateQueries({ queryKey: ["person"] });
    },
  });
}
