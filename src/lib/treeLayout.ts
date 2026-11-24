/**
 * Where each card goes in the tree view, centred on one person ("focus").
 * Plain TypeScript (no drawing), so it can be tested and shared by phone and web.
 *
 *  - Ancestors go up: a pedigree laid out with d3-hierarchy, parents side by side.
 *  - Descendants go down: each person sits with their partner(s) as a "couple
 *    unit"; children hang from the couple. Also laid out with d3-hierarchy.
 *  - The focus person's siblings sit to their left; partners to their right.
 *  - Friends (optional layer) sit to the far right of the focus row.
 *
 * Coordinates are in points; the focus card's top-left corner is (0, 0).
 */
import { hierarchy, tree, type HierarchyPointNode } from "d3-hierarchy";

export const CARD_W = 150;
export const CARD_H = 76;
const COL = CARD_W + 24; // horizontal distance between neighbouring cards
const ROW = CARD_H + 64; // vertical distance between generations

export type LayoutMode = "family" | "ancestors" | "descendants";

export type LayoutPerson = { id: string; sex: string; birthYear: number | null };
export type LayoutLink = { type: string; subtype: string | null; person_a: string; person_b: string };

export type LayoutNode = {
  /** Unique per card (a person can appear twice, e.g. cousins who married). */
  key: string;
  personId: string;
  x: number;
  y: number;
  role: "focus" | "person" | "friend";
};

export type LayoutEdge = {
  key: string;
  kind: "parent" | "partner" | "friend";
  /** Polyline through these points. */
  points: [number, number][];
};

export type TreeLayout = {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
};

export type LayoutOptions = {
  mode: LayoutMode;
  /** Generations to show above and below the focus person (1–5). */
  generations: number;
  showFriends: boolean;
};

type Unit = { personId: string; partners: string[]; children: Unit[] };
type Pedigree = { personId: string; parents: Pedigree[] };

export function layoutTree(
  people: LayoutPerson[],
  links: LayoutLink[],
  focusId: string,
  options: LayoutOptions,
): TreeLayout {
  const byId = new Map(people.map((p) => [p.id, p]));
  if (!byId.has(focusId)) return { nodes: [], edges: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };

  // --- Who is connected to whom ------------------------------------------------
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  const partnersOf = new Map<string, string[]>();
  const siblingsOf = new Map<string, string[]>();
  const friendsOf = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, value: string) => {
    if (!byId.has(key) || !byId.has(value)) return;
    const list = map.get(key) ?? [];
    if (!list.includes(value)) list.push(value);
    map.set(key, list);
  };
  for (const l of links) {
    if (l.type === "parent") {
      push(parentsOf, l.person_b, l.person_a);
      push(childrenOf, l.person_a, l.person_b);
    } else if (l.type === "partner") {
      push(partnersOf, l.person_a, l.person_b);
      push(partnersOf, l.person_b, l.person_a);
    } else if (l.type === "sibling") {
      push(siblingsOf, l.person_a, l.person_b);
      push(siblingsOf, l.person_b, l.person_a);
    } else if (l.type === "friend") {
      push(friendsOf, l.person_a, l.person_b);
      push(friendsOf, l.person_b, l.person_a);
    }
  }
  const byAge = (a: string, b: string) =>
    (byId.get(a)!.birthYear ?? 9999) - (byId.get(b)!.birthYear ?? 9999) || a.localeCompare(b);
  /**
   * Who sits beside someone as a couple: their partners, plus the other parent
   * of any of their children (people often add both parents of a child without
   * also linking the parents as partners).
   */
  const coupleOf = (id: string) => {
    const list = [...(partnersOf.get(id) ?? [])];
    for (const child of childrenOf.get(id) ?? []) {
      for (const other of parentsOf.get(child) ?? []) {
        if (other !== id && !list.includes(other)) list.push(other);
      }
    }
    return list.sort(byAge);
  };
  // Fathers on the left, mothers on the right (a common family-tree convention).
  const parentOrder = (a: string, b: string) => {
    const rank = (id: string) => (byId.get(id)!.sex === "male" ? 0 : byId.get(id)!.sex === "female" ? 2 : 1);
    return rank(a) - rank(b) || a.localeCompare(b);
  };

  const generations = Math.max(1, Math.min(5, options.generations));
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  const addNode = (key: string, personId: string, x: number, y: number, role: LayoutNode["role"] = "person") =>
    nodes.push({ key, personId, x, y, role });

  // --- Focus person and their partners ----------------------------------------
  const showPartners = options.mode !== "ancestors";
  const focusPartners = showPartners ? coupleOf(focusId) : [];
  addNode(`focus:${focusId}`, focusId, 0, 0, "focus");
  focusPartners.forEach((p, i) => {
    addNode(`partner:${p}`, p, (i + 1) * COL, 0);
    edges.push(partnerEdge(`pe:${focusId}:${p}`, i * COL, (i + 1) * COL, 0));
  });
  let rightEdge = focusPartners.length * COL;

  // --- Ancestors (up) -------------------------------------------------------------
  // Where the line down from the focus person's parents starts (siblings use it).
  let focusParentStart: Point | null = null;
  if (options.mode !== "descendants") {
    const seen = new Set<string>();
    const build = (id: string, depth: number): Pedigree => {
      seen.add(id);
      const parents =
        depth < generations
          ? [...(parentsOf.get(id) ?? [])].sort(parentOrder).map((p) => build(p, depth + 1))
          : [];
      return { personId: id, parents };
    };
    const root = hierarchy<Pedigree>(build(focusId, 0), (d) => d.parents);
    const laid = tree<Pedigree>()
      .nodeSize([COL, ROW])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.25))(root);
    const shift = -laid.x;
    laid.each((n) => {
      if (n.depth === 0) return;
      addNode(`anc:${pathKey(n)}`, n.data.personId, n.x + shift, -n.depth * ROW);
    });
    laid.each((n) => {
      const parents = n.children ?? []; // in the pedigree, "children" are parents
      if (!parents.length) return;
      const childY = -n.depth * ROW;
      const parentY = childY - ROW;
      const xs = parents.map((k) => k.x + shift);
      let start: Point;
      if (parents.length === 2) {
        edges.push(partnerEdge(`ape:${pathKey(n)}`, Math.min(...xs), Math.max(...xs), parentY));
        start = coupleMid(Math.min(...xs), Math.max(...xs), parentY);
      } else {
        start = below(xs[0]!, parentY);
      }
      if (n.depth === 0) focusParentStart = start;
      edges.push(elbow(`aedge:${pathKey(n)}`, start, n.x + shift, childY));
    });
  }

  // --- Siblings (left of the focus person) ------------------------------------------
  if (options.mode === "family") {
    const focusParents = parentsOf.get(focusId) ?? [];
    const viaParents = focusParents.flatMap((p) => childrenOf.get(p) ?? []);
    const siblings = [...new Set([...viaParents, ...(siblingsOf.get(focusId) ?? [])])]
      .filter((id) => id !== focusId)
      .sort(byAge);
    // Older siblings further left.
    siblings.reverse().forEach((s, i) => {
      const x = -(i + 1) * COL;
      addNode(`sib:${s}`, s, x, 0);
      const sharesParents = focusParents.some((p) => (parentsOf.get(s) ?? []).includes(p));
      if (sharesParents && focusParentStart) {
        // From the parents' connector down to this sibling.
        edges.push(elbow(`sedge:${s}`, focusParentStart, x, 0));
      } else {
        // A sibling linked directly (no shared parents in the tree): dashed tie.
        edges.push({ key: `slink:${s}`, kind: "friend", points: [[x + CARD_W, CARD_H / 2], [x + COL, CARD_H / 2]] });
      }
    });
  }

  // --- Descendants (down) -----------------------------------------------------------
  if (options.mode !== "ancestors") {
    const build = (id: string, depth: number, partners: string[]): Unit => ({
      personId: id,
      partners,
      children:
        depth < generations
          ? [...(childrenOf.get(id) ?? [])]
              .sort(byAge)
              .map((c) => build(c, depth + 1, coupleOf(c)))
          : [],
    });
    const rootUnit = build(focusId, 0, focusPartners);
    const width = (u: Unit) => 1 + u.partners.length;
    const root = hierarchy<Unit>(rootUnit, (u) => u.children);
    const laid = tree<Unit>()
      .nodeSize([COL, ROW])
      .separation((a, b) => (width(a.data) + width(b.data)) / 2 + (a.parent === b.parent ? 0 : 0.25))(root);
    // Left edge of a unit's first card, given the unit's centre.
    const left = (n: HierarchyPointNode<Unit>) => n.x - ((width(n.data) - 1) * COL) / 2;
    const shift = -left(laid);
    laid.each((n) => {
      if (n.depth === 0) return;
      const x0 = left(n) + shift;
      const y = n.depth * ROW;
      addNode(`desc:${pathKey(n)}`, n.data.personId, x0, y);
      n.data.partners.forEach((p, i) => {
        addNode(`desc:${pathKey(n)}:partner:${p}`, p, x0 + (i + 1) * COL, y);
        edges.push(partnerEdge(`dpe:${pathKey(n)}:${p}`, x0 + i * COL, x0 + (i + 1) * COL, y));
      });
    });
    laid.each((n) => {
      const x0 = left(n) + shift;
      const y = n.depth * ROW;
      for (const child of n.children ?? []) {
        // Hang from the couple when the child's other parent is a partner shown
        // here; otherwise from the parent alone.
        const otherParent = (parentsOf.get(child.data.personId) ?? []).find((p) => n.data.partners.includes(p));
        const i = otherParent ? n.data.partners.indexOf(otherParent) : -1;
        const start = otherParent ? coupleMid(x0 + i * COL, x0 + (i + 1) * COL, y) : below(x0, y);
        edges.push(elbow(`dedge:${pathKey(child)}`, start, left(child) + shift, child.depth * ROW));
      }
    });
    rightEdge = Math.max(rightEdge, ...nodes.filter((n) => n.y === 0).map((n) => n.x));
  }

  // --- Friends layer -----------------------------------------------------------------
  if (options.showFriends) {
    const shown = new Set(nodes.map((n) => n.personId));
    const friends = [...(friendsOf.get(focusId) ?? [])].filter((f) => !shown.has(f)).sort(byAge);
    friends.forEach((f, i) => {
      const x = rightEdge + COL * 1.5 + i * COL;
      addNode(`friend:${f}`, f, x, 0, "friend");
      edges.push({ key: `fe:${f}`, kind: "friend", points: [[CARD_W, CARD_H / 2 + 10], [x, CARD_H / 2 + 10]] });
    });
  }

  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  return {
    nodes,
    edges,
    bounds: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs) + CARD_W, maxY: Math.max(...ys) + CARD_H },
  };
}

/** A unique key from the path of ids down to a hierarchy node. */
function pathKey(n: { data: { personId: string }; ancestors(): { data: { personId: string } }[] }) {
  return n
    .ancestors()
    .map((a) => a.data.personId)
    .join(">");
}

/** A horizontal line between two cards on the same row (left card's x, right card's x). */
function partnerEdge(key: string, leftX: number, rightX: number, y: number): LayoutEdge {
  return { key, kind: "partner", points: [[leftX + CARD_W, y + CARD_H / 2], [rightX, y + CARD_H / 2]] };
}

type Point = [number, number];

/** Middle of the line between two partners' cards (left card x, right card x). */
function coupleMid(leftX: number, rightX: number, y: number): Point {
  return [(leftX + CARD_W + rightX) / 2, y + CARD_H / 2];
}

/** Just below the middle of a single card. */
function below(x: number, y: number): Point {
  return [x + CARD_W / 2, y + CARD_H];
}

/** A parent-to-child connector: down from `start`, across, and down to the child's card. */
function elbow(key: string, start: Point, childX: number, childY: number): LayoutEdge {
  const midY = childY - (ROW - CARD_H) / 2;
  const endX = childX + CARD_W / 2;
  return { key, kind: "parent", points: [start, [start[0], midY], [endX, midY], [endX, childY]] };
}
