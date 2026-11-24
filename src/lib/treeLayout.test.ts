import { describe, expect, it } from "vitest";

import { CARD_H, CARD_W, layoutTree, type LayoutLink, type LayoutNode, type LayoutPerson } from "./treeLayout";

/**
 *   gpa ─ gma            mgpa
 *       │                  │
 *      dad ═══════════════ mum
 *        ┌──────┼───────┐
 *     sisOld   me ═ wife    sisYoung       pal (friend)
 *            ┌───┴───┐
 *          kid1     kid2 ═ kid2wife
 *                     │
 *                  grandkid
 */
const P = (id: string, sex: string, birthYear: number | null = null): LayoutPerson => ({ id, sex, birthYear });
const people = [
  P("gpa", "male", 1920), P("gma", "female", 1922), P("mgpa", "male", 1925),
  P("dad", "male", 1950), P("mum", "female", 1952),
  P("sisOld", "female", 1975), P("me", "male", 1980), P("sisYoung", "female", 1985), P("wife", "female", 1981),
  P("kid1", "female", 2005), P("kid2", "male", 2008), P("kid2wife", "female", 2008), P("grandkid", "male", 2030),
  P("pal", "unknown"),
];
const parent = (a: string, b: string): LayoutLink => ({ type: "parent", subtype: "biological", person_a: a, person_b: b });
const pair = (type: string, a: string, b: string): LayoutLink => ({ type, subtype: null, person_a: a, person_b: b });
const links: LayoutLink[] = [
  parent("gpa", "dad"), parent("gma", "dad"), parent("mgpa", "mum"),
  pair("partner", "dad", "mum"),
  parent("dad", "sisOld"), parent("mum", "sisOld"), parent("dad", "me"), parent("mum", "me"),
  parent("dad", "sisYoung"), parent("mum", "sisYoung"),
  pair("partner", "me", "wife"),
  parent("me", "kid1"), parent("wife", "kid1"), parent("me", "kid2"), parent("wife", "kid2"),
  pair("partner", "kid2", "kid2wife"), parent("kid2", "grandkid"), parent("kid2wife", "grandkid"),
  pair("friend", "me", "pal"),
];

const family = (opts: Partial<{ mode: "family" | "ancestors" | "descendants"; generations: number; showFriends: boolean }> = {}) =>
  layoutTree(people, links, "me", { mode: "family", generations: 3, showFriends: false, ...opts });

const at = (nodes: LayoutNode[], id: string) => nodes.filter((n) => n.personId === id);
const one = (nodes: LayoutNode[], id: string) => {
  const found = at(nodes, id);
  expect(found).toHaveLength(1);
  return found[0]!;
};

describe("layoutTree", () => {
  it("puts the focus person at the origin", () => {
    expect(one(family().nodes, "me")).toMatchObject({ x: 0, y: 0, role: "focus" });
  });

  it("parents are one row up and centred over the focus person", () => {
    const { nodes } = family();
    const dad = one(nodes, "dad");
    const mum = one(nodes, "mum");
    expect(dad.y).toBeLessThan(0);
    expect(dad.y).toBe(mum.y);
    expect(dad.x).toBeLessThan(mum.x); // father on the left
    expect((dad.x + mum.x) / 2).toBeCloseTo(0);
    expect(one(nodes, "gpa").y).toBeLessThan(dad.y);
  });

  it("partners sit beside each other; siblings on the left of the focus row", () => {
    const { nodes } = family();
    const wife = one(nodes, "wife");
    expect(wife.y).toBe(0);
    expect(wife.x).toBeGreaterThan(0);
    const older = one(nodes, "sisOld");
    const younger = one(nodes, "sisYoung");
    expect(older.y).toBe(0);
    expect(older.x).toBeLessThan(younger.x); // older further left
    expect(younger.x).toBeLessThan(0);
  });

  it("children hang below the couple, grandchildren below them", () => {
    const { nodes } = family();
    const kid1 = one(nodes, "kid1");
    const kid2 = one(nodes, "kid2");
    expect(kid1.y).toBeGreaterThan(0);
    expect(kid1.y).toBe(kid2.y);
    expect(kid1.x).toBeLessThan(kid2.x); // older first
    expect(one(nodes, "kid2wife").x).toBeGreaterThan(kid2.x); // partner beside
    expect(one(nodes, "grandkid").y).toBeGreaterThan(kid2.y);
  });

  it("never overlaps two cards", () => {
    for (const mode of ["family", "ancestors", "descendants"] as const) {
      const { nodes } = family({ mode, showFriends: true });
      for (const a of nodes) {
        for (const b of nodes) {
          if (a === b) continue;
          const overlap = Math.abs(a.x - b.x) < CARD_W && Math.abs(a.y - b.y) < CARD_H;
          expect(overlap, `${a.personId} overlaps ${b.personId} in ${mode}`).toBe(false);
        }
      }
    }
  });

  it("respects the number of generations", () => {
    const one_gen = family({ generations: 1 }).nodes;
    expect(at(one_gen, "dad")).toHaveLength(1);
    expect(at(one_gen, "gpa")).toHaveLength(0);
    expect(at(one_gen, "kid1")).toHaveLength(1);
    expect(at(one_gen, "grandkid")).toHaveLength(0);
  });

  it("ancestor view shows only the way up; descendant view only the way down", () => {
    const up = family({ mode: "ancestors" }).nodes.map((n) => n.personId);
    expect(up).toContain("gpa");
    expect(up).not.toContain("kid1");
    expect(up).not.toContain("wife");
    const down = family({ mode: "descendants" }).nodes.map((n) => n.personId);
    expect(down).toContain("grandkid");
    expect(down).not.toContain("dad");
    expect(down).not.toContain("sisOld");
  });

  it("shows friends only when the friends layer is on", () => {
    expect(at(family().nodes, "pal")).toHaveLength(0);
    expect(one(family({ showFriends: true }).nodes, "pal")).toMatchObject({ y: 0, role: "friend" });
  });

  it("draws parent lines that end at the top of each child's card", () => {
    const { nodes, edges } = family();
    const kid1 = one(nodes, "kid1");
    const toKid1 = edges.find((e) => e.kind === "parent" && e.points.at(-1)![1] === kid1.y && e.points.at(-1)![0] === kid1.x + CARD_W / 2);
    expect(toKid1).toBeDefined();
  });

  it("re-centres on anyone", () => {
    const { nodes } = layoutTree(people, links, "kid2", { mode: "family", generations: 2, showFriends: false });
    expect(one(nodes, "kid2")).toMatchObject({ x: 0, y: 0, role: "focus" });
    expect(one(nodes, "me").y).toBeLessThan(0); // now a parent, above
    expect(one(nodes, "kid1").y).toBe(0); // now a sibling, same row
  });

  it("shows a child's other parent beside a person even without a partner link", () => {
    // gpa and gma are both parents of dad but were never linked as partners.
    const { nodes, edges } = layoutTree(people, links, "gpa", { mode: "descendants", generations: 1, showFriends: false });
    const gma = one(nodes, "gma");
    expect(gma.y).toBe(0);
    expect(gma.x).toBeGreaterThan(0);
    expect(edges.some((e) => e.kind === "partner")).toBe(true);
    // dad's line starts at the middle of the gpa–gma couple line.
    const coupleMiddle = (CARD_W + gma.x) / 2;
    const dadLine = edges.find((e) => e.kind === "parent" && e.key.includes("dad"))!;
    expect(dadLine.points[0][0]).toBeCloseTo(coupleMiddle);
  });
});
