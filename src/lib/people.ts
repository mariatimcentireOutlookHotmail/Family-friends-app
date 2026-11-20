import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "./auth";
import type { LifeEvent, PartialDate } from "./dates";
import { isPostgrestError } from "./postgrestError";
import type { Certainty, LinkedPerson, Relation, RelationshipRow, RelationshipSubtype } from "./relatives";
import { supabase } from "./supabase";
import { myTreesKey, type NewName, type PersonName, type Sex } from "./trees";

export type TreeRole = "owner" | "editor" | "viewer";

export type PrivacyField = "birth_date" | "death_date" | "contact";
export type PrivacyLevel = "private" | "immediate" | "tree";

/** What the signed-in user may see and do for a person (from the database). */
export type Access = {
  /** A minor the viewer may not see: show a placeholder. */
  hiddenMinor: boolean;
  isMinor: boolean;
  canSeeContacts: boolean;
  canChangePrivacy: boolean;
  levels: Record<PrivacyField, PrivacyLevel>;
};

export type Contacts = { phone: string | null; email: string | null; address: string | null };

export type PersonDetails = {
  id: string;
  tree_id: string;
  claimed_by_user_id: string | null;
  sex: Sex;
  living_status: LinkedPerson["living_status"];
  /** ISO country code, for the minors' age limit. */
  country: string | null;
  my_access: Access | null;
  /** Only present when the viewer may see them. */
  person_contacts: Contacts | Contacts[] | null;
  person_names: PersonName[];
  /** Birth/death; day and month only when the viewer may see them. */
  events: LifeEvent[];
  relationships: RelationshipRow[];
  /** The signed-in user's role in this person's tree. */
  myRole: TreeRole | null;
};

export const personKey = (personId: string) => ["person", personId] as const;

const LINKED = "id, living_status, person_names(full_display, is_primary, script, type)";

/** One person with their names, their links (both directions) and your role. */
export function usePerson(personId: string | undefined) {
  const { session } = useAuth();
  return useQuery({
    queryKey: personKey(personId ?? ""),
    enabled: Boolean(personId && session),
    queryFn: async (): Promise<PersonDetails | null> => {
      const { data: person, error } = await supabase
        .from("persons")
        .select(
          `id, tree_id, claimed_by_user_id, sex, living_status, country, my_access,
           person_names(given, family, full_display, is_primary, script, type),
           events(type, year, qualifier, has_full_date, event_dates(month, day)),
           person_contacts(phone, email, address)`,
        )
        .eq("id", personId!)
        .maybeSingle();
      if (error) throw error;
      if (!person) return null; // not found, or not allowed to see

      const [links, role] = await Promise.all([
        supabase
          .from("relationships")
          .select(
            `id, type, subtype, certainty, person_a, person_b,
             a:persons!relationships_person_a_fkey(${LINKED}),
             b:persons!relationships_person_b_fkey(${LINKED})`,
          )
          .or(`person_a.eq.${personId},person_b.eq.${personId}`),
        supabase
          .from("tree_members")
          .select("role")
          .eq("tree_id", person.tree_id)
          .eq("user_id", session!.user.id)
          .maybeSingle(),
      ]);
      if (links.error) throw links.error;
      if (role.error) throw role.error;

      return {
        ...(person as Omit<PersonDetails, "relationships" | "myRole">),
        relationships: (links.data ?? []) as unknown as RelationshipRow[],
        myRole: (role.data?.role as TreeRole | undefined) ?? null,
      };
    },
  });
}

export type AddRelativeInput = {
  anchorId: string;
  relation: Relation;
  subtype: RelationshipSubtype | null;
  certainty: Certainty;
  names: NewName[]; // the first is the main name
  sex: Sex;
  living: LinkedPerson["living_status"];
  /** When adding a child: link this person as the other parent too. */
  otherParentId: string | null;
  birth: PartialDate | null;
  death: PartialDate | null;
};

/** Why adding a relative failed, as a translation key under add.errors. */
export type AddRelativeErrorKey = "loop" | "tooManyParents" | "duplicate" | "notAllowed" | "failed";

export function addRelativeErrorKey(error: unknown): AddRelativeErrorKey {
  if (!isPostgrestError(error)) return "failed";
  const message = error.message ?? "";
  if (message.includes("own ancestor")) return "loop";
  if (message.includes("biological parents")) return "tooManyParents";
  if (error.code === "23505") return "duplicate";
  if (message.includes("row-level security") || error.code === "42501") return "notAllowed";
  return "failed";
}

/** Adds a new person related to an existing one (one database call). */
export function useAddRelative() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddRelativeInput): Promise<string> => {
      const { data, error } = await supabase.rpc("add_relative", {
        p_anchor: input.anchorId,
        p_relation: input.relation,
        p_subtype: input.relation === "friend" ? null : input.subtype,
        p_names: input.names,
        p_sex: input.sex,
        p_living: input.living,
        p_certainty: input.certainty,
        p_other_parent: input.otherParentId,
        p_birth: input.birth,
        p_death: input.death,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: async (_newId, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: myTreesKey(session?.user.id) }),
        queryClient.invalidateQueries({ queryKey: personKey(input.anchorId) }),
        input.otherParentId
          ? queryClient.invalidateQueries({ queryKey: personKey(input.otherParentId) })
          : Promise.resolve(),
      ]);
    },
  });
}

// -----------------------------------------------------------------------------
// Editing
// -----------------------------------------------------------------------------

/** Who may do what with a person, from the signed-in user's point of view. */
export function permissionsFor(person: PersonDetails, userId: string | undefined) {
  const isEditorOrOwner = person.myRole === "owner" || person.myRole === "editor";
  const claimed = person.claimed_by_user_id !== null;
  const hidden = person.my_access?.hiddenMinor ?? false;
  return {
    /** Change names and details: the claimant, or owners/editors if unclaimed. */
    canEditPerson: !hidden && (claimed ? person.claimed_by_user_id === userId : isEditorOrOwner),
    /** Change or remove links (also for claimed people). */
    canEditLinks: isEditorOrOwner,
    /** Delete: only owners, and never a claimed person. */
    canDelete: !hidden && person.myRole === "owner" && !claimed,
    /** Change privacy levels: the claimant, or owners if unclaimed. */
    canChangePrivacy: person.my_access?.canChangePrivacy ?? false,
    /** A minor the viewer may not see: show a placeholder. */
    hiddenMinor: hidden,
    /** Claimed by someone else, so the user can't edit names/details. */
    claimedBySomeoneElse: claimed && person.claimed_by_user_id !== userId,
  };
}

/** Refresh everything that shows people after a change. */
function useRefreshPeople() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: myTreesKey(session?.user.id) }),
      queryClient.invalidateQueries({ queryKey: ["person"] }),
      queryClient.invalidateQueries({ queryKey: ["link"] }),
    ]);
}

export type SavePersonInput = {
  personId: string;
  names: NewName[]; // the first is the main name
  sex: Sex;
  living: LinkedPerson["living_status"];
  /** The dates to keep; null removes a date. */
  birth: PartialDate | null;
  death: PartialDate | null;
  country: string | null;
  /** Only sent when the user may see contacts (otherwise left unchanged). */
  contacts: Contacts | null;
};

/** Why saving failed, as a key under person.errors in the edit translations. */
export function editErrorKey(error: unknown): "notAllowed" | "failed" {
  if (!isPostgrestError(error)) return "failed";
  if (error.code === "42501" || error.message.includes("can't edit")) return "notAllowed";
  return "failed";
}

export function useSavePerson() {
  const refresh = useRefreshPeople();
  return useMutation({
    mutationFn: async (input: SavePersonInput) => {
      const { error } = await supabase.rpc("save_person", {
        p_person: input.personId,
        p_names: input.names,
        p_sex: input.sex,
        p_living: input.living,
        p_birth: input.birth,
        p_death: input.death,
        p_details: input.contacts
          ? { country: input.country, contacts: input.contacts }
          : { country: input.country },
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
}

export function useDeletePerson() {
  const refresh = useRefreshPeople();
  return useMutation({
    mutationFn: async (personId: string) => {
      // count: "exact" tells us whether the rules let the delete through.
      const { error, count } = await supabase.from("persons").delete({ count: "exact" }).eq("id", personId);
      if (error) throw error;
      if (count === 0) throw new Error("not allowed");
    },
    // Don't wait for the refresh: the screen showing this person must be able
    // to move away first, or it would switch to "not found" and stay there.
    onSuccess: () => {
      void refresh();
    },
  });
}

export type LinkDetails = RelationshipRow;

export const linkKey = (linkId: string) => ["link", linkId] as const;

/** One relationship with both people, for the link editor. */
export function useLink(linkId: string | undefined) {
  return useQuery({
    queryKey: linkKey(linkId ?? ""),
    enabled: Boolean(linkId),
    queryFn: async (): Promise<LinkDetails | null> => {
      const { data, error } = await supabase
        .from("relationships")
        .select(
          `id, type, subtype, certainty, person_a, person_b,
           a:persons!relationships_person_a_fkey(${LINKED}),
           b:persons!relationships_person_b_fkey(${LINKED})`,
        )
        .eq("id", linkId!)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as LinkDetails | null) ?? null;
    },
  });
}

export function useUpdateLink() {
  const refresh = useRefreshPeople();
  return useMutation({
    mutationFn: async (input: { linkId: string; subtype: RelationshipSubtype | null; certainty: Certainty }) => {
      const { error, count } = await supabase
        .from("relationships")
        .update({ subtype: input.subtype, certainty: input.certainty }, { count: "exact" })
        .eq("id", input.linkId);
      if (error) throw error;
      if (count === 0) throw new Error("not allowed");
    },
    onSuccess: refresh,
  });
}

export function useRemoveLink() {
  const refresh = useRefreshPeople();
  return useMutation({
    mutationFn: async (linkId: string) => {
      const { error, count } = await supabase.from("relationships").delete({ count: "exact" }).eq("id", linkId);
      if (error) throw error;
      if (count === 0) throw new Error("not allowed");
    },
    // As with deleting a person: let the screen move away before refreshing.
    onSuccess: () => {
      void refresh();
    },
  });
}

/** The contact details row, if the viewer may see one. */
export function contactsOf(person: PersonDetails): Contacts | null {
  const c = Array.isArray(person.person_contacts) ? person.person_contacts[0] : person.person_contacts;
  return c ?? null;
}

/** Change one privacy level (null = back to the default). */
export function useSetPrivacy() {
  const refresh = useRefreshPeople();
  return useMutation({
    mutationFn: async (input: { personId: string; field: PrivacyField; level: PrivacyLevel | null }) => {
      const { error } = await supabase.rpc("set_privacy", {
        p_person: input.personId,
        p_field: input.field,
        p_level: input.level,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
}
