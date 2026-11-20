/**
 * Finding how two people are related: the shortest chain of links from "you"
 * (ego) to someone else, e.g. parent → sibling → child (= a cousin).
 *
 * Labels are never stored: the path is worked out each time, from the viewer's
 * point of view, then turned into a word by a function per language.
 */

export type KinSex = "female" | "male" | "other" | "unknown";

export type KinPerson = {
  id: string;
  sex: KinSex;
  birthYear: number | null;
  birthOrder: number | null; // 1 = eldest among siblings
};

export type KinLink = {
  type: "parent" | "partner" | "sibling" | "friend";
  subtype: string | null;
  person_a: string; // for "parent": person_a is the parent of person_b
  person_b: string;
};

export type StepKind = "parent" | "child" | "spouse" | "sibling" | "friend";

export type Step = {
  kind: StepKind;
  /** The person this step arrives at. */
  to: KinPerson;
  sex: KinSex;
  subtype: string | null;
  /**
   * For sibling steps: is the person reached older than the one before?
   * null when unknown (no birth years or birth order to compare).
   */
  elder: boolean | null;
};

export type KinPath = {
  steps: Step[];
  /** Is the target older than ego? null when unknown. */
  targetElder: boolean | null;
};

/** Shorthand for a path's shape: P parent, C child, S spouse, B sibling, F friend. */
export function pathCode(path: KinPath): string {
  const letter: Record<StepKind, string> = { parent: "P", child: "C", spouse: "S", sibling: "B", friend: "F" };
  return path.steps.map((s) => letter[s.kind]).join("");
}

/** true if a is older than b, false if younger, null if unknown. */
export function isOlder(a: KinPerson, b: KinPerson): boolean | null {
  if (a.birthYear !== null && b.birthYear !== null && a.birthYear !== b.birthYear) {
    return a.birthYear < b.birthYear;
  }
  if (a.birthOrder !== null && b.birthOrder !== null && a.birthOrder !== b.birthOrder) {
    return a.birthOrder < b.birthOrder;
  }
  return null;
}

type Edge = { kind: StepKind; to: string; subtype: string | null };

const MAX_STEPS = 6;

export class KinGraph {
  readonly people = new Map<string, KinPerson>();
  private readonly edges = new Map<string, Edge[]>();
  private readonly parents = new Map<string, Set<string>>();

  constructor(people: KinPerson[], links: KinLink[]) {
    for (const p of people) {
      this.people.set(p.id, p);
      this.edges.set(p.id, []);
      this.parents.set(p.id, new Set());
    }
    for (const l of links) {
      if (!this.people.has(l.person_a) || !this.people.has(l.person_b)) continue;
      const add = (from: string, edge: Edge) => this.edges.get(from)!.push(edge);
      switch (l.type) {
        case "parent":
          add(l.person_b, { kind: "parent", to: l.person_a, subtype: l.subtype });
          add(l.person_a, { kind: "child", to: l.person_b, subtype: l.subtype });
          this.parents.get(l.person_b)!.add(l.person_a);
          break;
        case "partner":
          add(l.person_a, { kind: "spouse", to: l.person_b, subtype: l.subtype });
          add(l.person_b, { kind: "spouse", to: l.person_a, subtype: l.subtype });
          break;
        case "sibling":
          add(l.person_a, { kind: "sibling", to: l.person_b, subtype: l.subtype });
          add(l.person_b, { kind: "sibling", to: l.person_a, subtype: l.subtype });
          break;
        case "friend":
          add(l.person_a, { kind: "friend", to: l.person_b, subtype: null });
          add(l.person_b, { kind: "friend", to: l.person_a, subtype: null });
          break;
      }
    }
  }

  /**
   * The best path from ego to target, or null if they aren't connected within
   * a few steps. Blood links are preferred over marriage links of equal length.
   */
  findPath(egoId: string, targetId: string): KinPath | null {
    const ego = this.people.get(egoId);
    const target = this.people.get(targetId);
    if (!ego || !target || egoId === targetId) return null;

    const raw = this.search(egoId, targetId);
    if (raw) return this.toPath(egoId, raw, target);

    // Not family: maybe a direct friend.
    const friend = this.edges.get(egoId)!.find((e) => e.kind === "friend" && e.to === targetId);
    if (friend) return this.toPath(egoId, [friend], target);
    return null;
  }

  /** Lowest-cost search; spouse links cost a little more than blood links. */
  private search(from: string, to: string): Edge[] | null {
    const cost = (e: Edge) => (e.kind === "spouse" ? 1.1 : 1);
    const best = new Map<string, number>([[from, 0]]);
    const via = new Map<string, { prev: string; edge: Edge; steps: number }>();
    const queue: { id: string; cost: number; steps: number }[] = [{ id: from, cost: 0, steps: 0 }];

    while (queue.length) {
      queue.sort((a, b) => a.cost - b.cost);
      const current = queue.shift()!;
      if (current.id === to) break;
      if (current.cost > (best.get(current.id) ?? Infinity) || current.steps >= MAX_STEPS) continue;
      for (const edge of this.edges.get(current.id)!) {
        if (edge.kind === "friend") continue;
        const next = current.cost + cost(edge);
        if (next < (best.get(edge.to) ?? Infinity)) {
          best.set(edge.to, next);
          via.set(edge.to, { prev: current.id, edge, steps: current.steps + 1 });
          queue.push({ id: edge.to, cost: next, steps: current.steps + 1 });
        }
      }
    }

    if (!via.has(to)) return null;
    const edges: Edge[] = [];
    for (let id = to; id !== from; id = via.get(id)!.prev) edges.unshift(via.get(id)!.edge);
    return edges;
  }

  /** Edges → steps, turning "parent then child" into "sibling". */
  private toPath(egoId: string, edges: Edge[], target: KinPerson): KinPath {
    const ids = [egoId, ...edges.map((e) => e.to)];
    const steps: Step[] = [];
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i]!;
      const next = edges[i + 1];
      const prevId = ids[i]!;
      if (edge.kind === "parent" && next?.kind === "child" && ids[i + 2] !== prevId) {
        // Up to a shared parent and down again = a sibling.
        const siblingId = ids[i + 2]!;
        steps.push(this.siblingStep(prevId, siblingId, null));
        i++;
        continue;
      }
      const to = this.people.get(edge.to)!;
      steps.push(
        edge.kind === "sibling"
          ? this.siblingStep(prevId, edge.to, edge.subtype)
          : { kind: edge.kind, to, sex: to.sex, subtype: edge.subtype, elder: null },
      );
    }
    return { steps, targetElder: isOlder(target, this.people.get(egoId)!) };
  }

  private siblingStep(fromId: string, toId: string, subtype: string | null): Step {
    const to = this.people.get(toId)!;
    let kind = subtype;
    if (!kind) {
      // Through shared parents. "Half" only when both have two parents
      // entered and they differ; a parent simply not entered yet shouldn't
      // turn full siblings into half siblings.
      const a = this.parents.get(fromId)!;
      const b = this.parents.get(toId)!;
      const same = a.size === b.size && [...a].every((p) => b.has(p));
      kind = a.size >= 2 && b.size >= 2 && !same ? "half" : "full";
    }
    return { kind: "sibling", to, sex: to.sex, subtype: kind, elder: isOlder(to, this.people.get(fromId)!) };
  }
}
