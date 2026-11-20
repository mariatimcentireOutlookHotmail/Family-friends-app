import { describe, expect, it } from "vitest";

import { groupRelatives, type LinkedPerson, type RelationshipRow } from "./relatives";

function person(id: string, name: string): LinkedPerson {
  return {
    id,
    living_status: "living",
    person_names: [{ full_display: name, is_primary: true, script: null, type: "birth" }],
  };
}

const me = person("me", "Me");
const mum = person("mum", "Mum");
const kid = person("kid", "Kid");
const wife = person("wife", "Wife");
const sis = person("sis", "Sis");
const pal = person("pal", "Pal");

function row(id: string, a: LinkedPerson, b: LinkedPerson, type: RelationshipRow["type"], subtype: RelationshipRow["subtype"]): RelationshipRow {
  return { id, type, subtype, certainty: "confirmed", person_a: a.id, person_b: b.id, a, b };
}

describe("groupRelatives", () => {
  const rows = [
    row("1", mum, me, "parent", "biological"), // mum is my parent
    row("2", me, kid, "parent", "adoptive"), // kid is my child
    row("3", me, wife, "partner", "married"),
    row("4", sis, me, "sibling", "half"), // stored the other way round
    row("5", me, pal, "friend", null),
    row("6", mum, sis, "parent", "biological"), // not about me
  ];

  it("puts each relative in the right group, seen from me", () => {
    const g = groupRelatives("me", rows);
    expect(g.parents.map((r) => r.person.id)).toEqual(["mum"]);
    expect(g.children.map((r) => r.person.id)).toEqual(["kid"]);
    expect(g.partners.map((r) => r.person.id)).toEqual(["wife"]);
    expect(g.siblings.map((r) => r.person.id)).toEqual(["sis"]);
    expect(g.friends.map((r) => r.person.id)).toEqual(["pal"]);
  });

  it("keeps the subtype and ignores links that don't involve the person", () => {
    const g = groupRelatives("me", rows);
    expect(g.children[0]!.subtype).toBe("adoptive");
    expect(g.siblings[0]!.subtype).toBe("half");
    const total = Object.values(g).reduce((n, list) => n + list.length, 0);
    expect(total).toBe(5);
  });

  it("the same link reads the other way from the other person", () => {
    const g = groupRelatives("kid", rows);
    expect(g.parents.map((r) => r.person.id)).toEqual(["me"]);
    expect(g.children).toHaveLength(0);
  });
});
