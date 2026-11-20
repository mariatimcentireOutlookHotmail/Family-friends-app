import type { PersonName } from "./trees";

export type RelationshipType = "parent" | "partner" | "sibling" | "friend";
export type RelationshipSubtype =
  | "biological" | "adoptive" | "step" | "foster"
  | "married" | "unmarried" | "divorced" | "widowed"
  | "full" | "half";
export type Certainty = "confirmed" | "probable" | "uncertain";

/** How a NEW person relates to the one you start from. */
export type Relation = "parent" | "child" | "partner" | "sibling" | "friend";

/** Subtypes that make sense for each relation, the first being the default. */
export const SUBTYPES_FOR: Record<Relation, RelationshipSubtype[]> = {
  parent: ["biological", "adoptive", "step", "foster"],
  child: ["biological", "adoptive", "step", "foster"],
  partner: ["married", "unmarried", "divorced", "widowed"],
  sibling: ["full", "half", "step", "adoptive"],
  friend: [],
};

export type LinkedPerson = {
  id: string;
  living_status: "living" | "deceased" | "unknown";
  person_names: PersonName[];
};

/** A relationship row as loaded from the database, with both people. */
export type RelationshipRow = {
  id: string;
  type: RelationshipType;
  subtype: RelationshipSubtype | null;
  certainty: Certainty;
  person_a: string;
  person_b: string;
  a: LinkedPerson;
  b: LinkedPerson;
};

export type Relative = {
  relationshipId: string;
  person: LinkedPerson;
  subtype: RelationshipSubtype | null;
  certainty: Certainty;
};

export type RelativeGroups = Record<"parents" | "partners" | "children" | "siblings" | "friends", Relative[]>;

/**
 * Sort one person's links into groups, seen from that person.
 * "A parent of B": seen from B, A is a parent; seen from A, B is a child.
 */
export function groupRelatives(personId: string, rows: RelationshipRow[]): RelativeGroups {
  const groups: RelativeGroups = { parents: [], partners: [], children: [], siblings: [], friends: [] };
  for (const row of rows) {
    const otherIsB = row.person_a === personId;
    if (!otherIsB && row.person_b !== personId) continue; // not about this person
    const relative: Relative = {
      relationshipId: row.id,
      person: otherIsB ? row.b : row.a,
      subtype: row.subtype,
      certainty: row.certainty,
    };
    switch (row.type) {
      case "parent":
        (otherIsB ? groups.children : groups.parents).push(relative);
        break;
      case "partner":
        groups.partners.push(relative);
        break;
      case "sibling":
        groups.siblings.push(relative);
        break;
      case "friend":
        groups.friends.push(relative);
        break;
    }
  }
  return groups;
}
